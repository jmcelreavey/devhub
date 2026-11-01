import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z as legacyZod } from "zod";
import { expect, it, vi } from "vitest";
import { createVaultRoutes } from "../../../../apps/core/src/lib/vault/create-vault-routes";
import { getVault } from "../../../../apps/core/src/lib/vault/vault-registry";
import { createContext } from "../context.ts";
import { registerDocsTools } from "../tools/docs.ts";

it("reads docs through HTTP and headless MCP without weakening vault confinement", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-doc-action-"));
  const docs = path.join(root, "docs");
  const notes = path.join(root, "notes");
  fs.mkdirSync(docs);
  fs.mkdirSync(notes);
  fs.writeFileSync(path.join(docs, "example.md"), "example content");
  fs.writeFileSync(path.join(root, "secret.md"), "outside");
  fs.symlinkSync(path.join(root, "secret.md"), path.join(docs, "escape.md"));
  fs.writeFileSync(path.join(notes, "example.json"), JSON.stringify([{ type: "paragraph" }]));
  vi.stubEnv("DOCS_DIR", docs);
  vi.stubEnv("NOTES_DIR", notes);
  vi.stubEnv("DEVHUB_BASE_URL", "http://127.0.0.1:1");
  const revalidatePaths = getVault("docs").revalidatePaths;
  getVault("docs").revalidatePaths = [];
  const server = new McpServer({ name: "fixture", version: "1" });
  const ctx = createContext();
  expect(ctx.docContent).toBe(ctx.docsStorage.content);
  registerDocsTools(server, ctx);
  const legacy = new McpServer({ name: "legacy", version: "1" });
  legacy.registerTool("docs_read", {
    description: "Read a doc by relative path (with or without .md). Returns raw markdown.",
    inputSchema: legacyZod.object({ path: legacyZod.string().describe("Relative path (e.g. architecture/notes-system, SUMMARY)") }).meta({ additionalProperties: false }),
  }, async () => ({ content: [] }));
  legacy.registerTool("docs_write", {
    description: "Create or update a doc. Accepts markdown text.",
    inputSchema: legacyZod.object({ path: legacyZod.string().describe("Relative path for the doc (e.g. guides/skills)"), content: legacyZod.string().describe("Markdown content to write") }).meta({ additionalProperties: false }),
  }, async () => ({ content: [] }));
  legacy.registerTool("docs_append", {
    description: "Append markdown to an existing doc (or create it if missing).",
    inputSchema: legacyZod.object({ path: legacyZod.string().describe("Relative path to the doc"), content: legacyZod.string().describe("Markdown content to append") }).meta({ additionalProperties: false }),
  }, async () => ({ content: [] }));
  legacy.registerTool("docs_delete", {
    description: "Delete a doc by its relative path.",
    inputSchema: legacyZod.object({ path: legacyZod.string().describe("Relative path to the doc to delete") }).meta({ additionalProperties: false }),
  }, async () => ({ content: [] }));
  const [legacyServerTransport, legacyClientTransport] = InMemoryTransport.createLinkedPair();
  const legacyClient = new Client({ name: "legacy", version: "1" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "fixture", version: "1" });
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport), legacy.connect(legacyServerTransport), legacyClient.connect(legacyClientTransport)]);
  const get = (segments: string[], vault: "docs" | "notes" = "docs") => createVaultRoutes(vault).GET(
    new Request("http://fixture/api/vault"),
    { params: Promise.resolve({ path: segments }) },
  );
  const request = (method: "POST" | "PUT" | "DELETE", segments: string[], body?: unknown) => createVaultRoutes("docs")[method](
    new Request("http://fixture/api/docs", { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
    { params: Promise.resolve({ path: segments }) },
  );
  try {
    const actualTools = (await client.listTools()).tools;
    const legacyTools = (await legacyClient.listTools()).tools;
    for (const name of ["docs_read", "docs_append"]) {
      expect(actualTools.find((tool) => tool.name === name)).toEqual(legacyTools.find((tool) => tool.name === name));
    }
    for (const file of ["example", "example.md"]) {
      const response = await get([file]);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ path: "example.md", content: "example content" });
      expect(await client.callTool({ name: "docs_read", arguments: { path: file } })).toMatchObject({ content: [{ text: expect.stringContaining("example content") }] });
    }
    expect((await get(["missing"])).status).toBe(404);
    expect(await client.callTool({ name: "docs_read", arguments: { path: "missing" } })).toMatchObject({ content: [{ text: expect.stringContaining("Doc not found: missing") }] });
    expect(await client.callTool({ name: "docs_read", arguments: { path: "example", extra: true } })).toMatchObject({ content: [{ text: expect.stringContaining("example content") }] });
    expect(await client.callTool({ name: "docs_read", arguments: { path: 42 } })).toMatchObject({ isError: true });
    for (const segments of [["..", "secret"], ["escape"]]) {
      expect((await get(segments)).status).toBe(500);
      expect(await client.callTool({ name: "docs_read", arguments: { path: segments.join("/") } })).toMatchObject({ isError: true });
    }
    const note = await get(["example"], "notes");
    expect(note.status).toBe(200);
    expect(await note.json()).toMatchObject({ path: "example.json", content: [{ type: "paragraph" }] });

    const created = await request("POST", ["write"], { content: "first" });
    expect(created.status).toBe(201);
    expect((await request("POST", ["write"], { content: "overwrite" })).status).toBe(409);
    expect(await client.callTool({ name: "docs_read", arguments: { path: "write" } })).toMatchObject({ content: [{ text: expect.stringContaining("first") }] });
    expect(await client.callTool({ name: "docs_append", arguments: { path: "write", content: " second", extra: true } })).toMatchObject({ content: [{ text: expect.stringContaining("Appended to: write") }] });
    const staleRevision = (await ctx.docContent.read("write.md"))!.revision;
    expect((await request("PUT", ["write"], { content: "replacement", expectedRevision: staleRevision })).status).toBe(200);
    expect(await client.callTool({ name: "docs_write", arguments: { path: "write", content: "stale", expectedRevision: staleRevision } })).toMatchObject({ isError: true });
    expect(await client.callTool({ name: "docs_write", arguments: { path: "write", content: "mcp", expectedRevision: (await ctx.docContent.read("write.md"))!.revision } })).toMatchObject({ content: [{ text: expect.stringContaining("Updated: write") }] });
    expect((await (await get(["write"])).json()).content).toBe("mcp");
    expect(await client.callTool({ name: "docs_append", arguments: { path: "new", content: "created" } })).toMatchObject({ content: [{ text: expect.stringContaining("Created: new") }] });
    expect(await client.callTool({ name: "docs_write", arguments: { path: "bad", content: 12 } })).toMatchObject({ isError: true });
    expect((await request("PUT", ["bad"], { content: 12 })).status).toBe(400);
    for (const segments of [["..", "secret"], ["escape"]]) {
      expect((await request("PUT", segments, { content: "unsafe" })).status).toBe(500);
      expect(await client.callTool({ name: "docs_write", arguments: { path: segments.join("/"), content: "unsafe", expectedRevision: null } })).toMatchObject({ isError: true });
    }
    const writes = await Promise.all(["one", "two"].map((content) => request("POST", ["concurrent"], { content })));
    expect(writes.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(["one", "two"]).toContain((await (await get(["concurrent"])).json()).content);
    const oldRevision = (await ctx.docContent.read("write.md"))!.revision;
    expect((await request("DELETE", ["write"])).status).toBe(200);
    expect(await client.callTool({ name: "docs_delete", arguments: { path: "write", expectedRevision: oldRevision } })).toMatchObject({ isError: true });
    expect((await request("DELETE", ["write"])).status).toBe(404);
    expect(await client.callTool({ name: "docs_delete", arguments: { path: "new", expectedRevision: (await ctx.docContent.read("new.md"))!.revision } })).toMatchObject({ content: [{ text: "Deleted: new" }] });
  } finally {
    getVault("docs").revalidatePaths = revalidatePaths;
    consoleError.mockRestore();
    await client.close();
    await server.close();
    await legacyClient.close();
    await legacy.close();
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
