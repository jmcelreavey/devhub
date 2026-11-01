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
import { GET as getAsset } from "../../../../apps/core/src/http/routes/notes-assets/[...path]/route";
import { createContext } from "../context.ts";
import { registerNotesTools } from "../tools/notes.ts";

it("reads and deletes notes in both transports without bypassing stale-delete checks", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-note-action-"));
  fs.writeFileSync(path.join(root, "example.json"), JSON.stringify([{ type: "paragraph", content: [{ type: "text", text: "hello", styles: {} }] }]));
  vi.stubEnv("NOTES_DIR", root);
  vi.stubEnv("DEVHUB_BASE_URL", "http://127.0.0.1:1");
  const revalidatePaths = getVault("notes").revalidatePaths;
  getVault("notes").revalidatePaths = [];
  const server = new McpServer({ name: "fixture", version: "1" });
  const ctx = createContext();
  expect(ctx.noteContent).toBe(ctx.storage.content);
  registerNotesTools(server, ctx);
  const legacy = new McpServer({ name: "legacy", version: "1" });
  legacy.registerTool("notes_read", {
    description: "Read a note by its relative path (with or without .json). Returns the content as readable markdown text. Day journals: daily/YYYY-MM-DD. General scratch: root filenames like index.",
    inputSchema: legacyZod.object({ path: legacyZod.string().describe("Relative path (e.g. daily/2026-05-11, learnings/tools, my-scratch-note)") }).meta({ additionalProperties: false }),
  }, async () => ({ content: [] }));
  legacy.registerTool("notes_delete", {
    description: "Delete a note by its relative path.",
    inputSchema: legacyZod.object({ path: legacyZod.string().describe("Relative path to the note to delete") }).meta({ additionalProperties: false }),
  }, async () => ({ content: [] }));
  legacy.registerTool("notes_write", {
    description: "Create or update a note. Accepts markdown text, converts to structured format internally. Paths under pr-reviews/ auto-upsert a ## Links section with PR + repo EntityRefs (same shared/pr-note helper as notes_create_pr).",
    inputSchema: legacyZod.object({ path: legacyZod.string().describe("Relative path for the note (e.g. 'learnings/tools')"), content: legacyZod.string().describe("Markdown content to write") }).meta({ additionalProperties: false }),
  }, async () => ({ content: [] }));
  legacy.registerTool("notes_append", {
    description: "Append content to an existing note. Adds new blocks at the end.",
    inputSchema: legacyZod.object({ path: legacyZod.string().describe("Relative path to the note"), content: legacyZod.string().describe("Markdown content to append") }).meta({ additionalProperties: false }),
  }, async () => ({ content: [] }));
  legacy.registerTool("notes_write_asset", {
    description: "Write a binary image asset under the notes tree (e.g. garden/my-project/assets/photo-1.jpg). Use before notes_write when embedding photos via ![caption](path) markdown.",
    inputSchema: legacyZod.object({ path: legacyZod.string().describe("Notes-relative asset path (must not end in .json). Allowed: jpg, jpeg, png, gif, webp"), contentBase64: legacyZod.string().describe("Base64-encoded file bytes"), mimeType: legacyZod.string().optional().describe("Optional MIME hint (ignored if extension is valid)") }).meta({ additionalProperties: false }),
  }, async () => ({ content: [] }));
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const [legacyServerTransport, legacyClientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "fixture", version: "1" });
  const legacyClient = new Client({ name: "legacy", version: "1" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport), legacy.connect(legacyServerTransport), legacyClient.connect(legacyClientTransport)]);
  const routes = createVaultRoutes("notes");
  const params = { params: Promise.resolve({ path: ["example"] }) };
  try {
    const tools = (await client.listTools()).tools;
    const legacyTools = (await legacyClient.listTools()).tools;
    for (const name of ["notes_read", "notes_append"]) {
      expect(tools.find((tool) => tool.name === name)).toEqual(legacyTools.find((tool) => tool.name === name));
    }
    expect((await routes.GET(new Request("http://fixture/api/notes/example"), params)).status).toBe(200);
    expect(await client.callTool({ name: "notes_read", arguments: { path: "example" } })).toMatchObject({ content: [{ text: expect.stringContaining("hello") }] });
    expect((await routes.DELETE(new Request("http://fixture/api/notes/example?expectedModified=0", { method: "DELETE" }), params)).status).toBe(409);
    expect(await client.callTool({ name: "notes_delete", arguments: { path: "example", expectedRevision: (await ctx.noteContent.read("example.json"))!.revision } })).toMatchObject({ content: [{ text: "Deleted: example" }] });
    expect((await routes.GET(new Request("http://fixture/api/notes/example"), params)).status).toBe(404);
    expect(await client.callTool({ name: "notes_read", arguments: { path: "example" } })).toMatchObject({ content: [{ text: expect.stringContaining("Note not found: example") }] });
    expect(await client.callTool({ name: "notes_write", arguments: { path: "new", content: "# Original", expectedRevision: null } })).toMatchObject({ content: [{ text: expect.stringContaining("Created: new") }] });
    expect(await client.callTool({ name: "notes_append", arguments: { path: "new", content: "Extra" } })).toMatchObject({ content: [{ text: expect.stringContaining("Appended to: new") }] });
    const newParams = { params: Promise.resolve({ path: ["new"] }) };
    const note = await (await routes.GET(new Request("http://fixture/api/notes/new"), newParams)).json();
    expect(note.content).toHaveLength(2);
    const staleRevision = (await ctx.noteContent.read("new.json"))!.revision;
    const replacement = [{ type: "paragraph", content: [{ type: "text", text: "HTTP", styles: {} }] }];
    expect((await routes.PUT(new Request("http://fixture/api/notes/new", { method: "PUT", body: JSON.stringify({ content: replacement, expectedModified: note.modified }) }), newParams)).status).toBe(200);
    expect(await client.callTool({ name: "notes_write", arguments: { path: "new", content: "stale", expectedRevision: staleRevision } })).toMatchObject({ isError: true });
    expect(await client.callTool({ name: "notes_read", arguments: { path: "new" } })).toMatchObject({ content: [{ text: expect.stringContaining("HTTP") }] });
    expect(await client.callTool({ name: "notes_write_asset", arguments: { path: "assets/test.png", contentBase64: Buffer.from("image").toString("base64"), expectedRevision: null } })).toMatchObject({ content: [{ text: expect.stringContaining("Wrote asset: assets/test.png") }] });
    const asset = await getAsset(new Request("http://fixture/api/notes-assets/assets/test.png"), { params: Promise.resolve({ path: ["assets", "test.png"] }) });
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe("image");
    expect(asset.headers.get("content-type")).toBe("image/png");
    expect(await client.callTool({ name: "notes_write_asset", arguments: { path: "../escape.png", contentBase64: "YQ==", expectedRevision: null } })).toMatchObject({ isError: true });
    expect(await client.callTool({ name: "notes_write_asset", arguments: { path: "bad.json", contentBase64: "YQ==", expectedRevision: null } })).toMatchObject({ isError: true });
    expect(await client.callTool({ name: "notes_write_asset", arguments: { path: "empty.png", contentBase64: "", expectedRevision: null } })).toMatchObject({ isError: true });
  } finally {
    getVault("notes").revalidatePaths = revalidatePaths;
    await client.close();
    await server.close();
    await legacyClient.close();
    await legacy.close();
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
