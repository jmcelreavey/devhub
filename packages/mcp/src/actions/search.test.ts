import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { expect, test, vi } from "vitest";
import { GET } from "../../../../apps/core/src/http/routes/search/route";
import { DashboardHttpError } from "../dashboard-client.ts";
import type { Context } from "../context.ts";
import { registerSearchTools } from "../tools/search.ts";

test("HTTP and MCP search preserve vault selection and reject escaping prefixes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-search-action-"));
  const docs = path.join(root, "docs");
  fs.mkdirSync(path.join(docs, "inside"), { recursive: true });
  fs.mkdirSync(path.join(root, "notes"));
  fs.writeFileSync(path.join(docs, "inside", "fixture.md"), "needle in a fixture");
  vi.stubEnv("DOCS_DIR", docs);
  vi.stubEnv("NOTES_DIR", path.join(root, "notes"));
  const get = (query: Record<string, string>) => GET(new Request(`http://fixture/api/search?${new URLSearchParams(query)}`));
  const server = new McpServer({ name: "fixture", version: "1" });
  registerSearchTools(server, { dashboard: { get: async (_path: string, query: Record<string, string>) => {
    const response = await get(query);
    const body = await response.json();
    if (!response.ok) throw new DashboardHttpError(response.status, body, body.error);
    return body;
  } } } as unknown as Context);
  const client = new Client({ name: "fixture", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    expect(await (await get({ q: "needle", vault: "docs", prefix: "inside/" })).json()).toMatchObject({ files: [{ path: "inside/fixture" }] });
    expect(await client.callTool({ name: "search", arguments: { query: "needle", vault: "docs", prefix: "inside/" } })).toMatchObject({ content: [{ text: expect.stringContaining("inside/fixture") }] });
    expect((await get({ q: "" })).status).toBe(400);
    for (const prefix of ["../", "/outside", "inside/../"]) {
      expect((await get({ q: "needle", prefix })).status).toBe(400);
      expect(await client.callTool({ name: "search", arguments: { query: "needle", prefix } })).toMatchObject({ isError: true });
    }
  } finally {
    await client.close();
    await server.close();
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
