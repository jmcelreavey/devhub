import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, it } from "vitest";

it("keeps legacy tool schemas and validation identical in source and bundled stdio", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-zod-stdio-"));
  const serverRoot = path.resolve(__dirname, "..");
  const settings = {
    tiers: { cheap: { provider: "", model: "" }, mid: { provider: "", model: "" }, heavy: { provider: "", model: "" } },
    steps: { plan: "mid", implement: "mid", verify: "cheap", "draft-pr": "cheap", review: "heavy" },
  };
  const received: unknown[] = [];
  const httpServer = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    request.on("end", () => {
      if (request.method === "PUT") received.push(JSON.parse(body));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ settings }));
    });
  });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("Fixture listener failed");
  const results = [];
  try {
    const tsx = createRequire(path.join(serverRoot, "package.json")).resolve("tsx/cli");
    for (const bundled of [false, true]) {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: bundled ? [path.join(serverRoot, "bin/devhub-mcp.mjs")] : [tsx, path.join(serverRoot, "src/mcp.ts")],
        cwd: serverRoot,
        env: { PATH: process.env.PATH ?? "", HOME: root, NOTES_DIR: root, DOCS_DIR: root, TASKS_DIR: root, DEVHUB_CONFIG_DIR: root, DEVHUB_MCP_HISTORY: "0", DEVHUB_MCP_TOOLSETS: "storyboard,docs,notes", DEVHUB_BASE_URL: `http://127.0.0.1:${address.port}` },
        stderr: "pipe",
      });
      const client = new Client({ name: "zod-compatibility-test", version: "1" });
      try {
        await client.connect(transport);
        const tools = (await client.listTools()).tools;
        expect(tools.find((tool) => tool.name === "docs_read")?.inputSchema.additionalProperties).toBe(false);
        const defaults = await client.callTool({ name: "storyboard_reset", arguments: { taskId: "test" } });
        const validRecord = await client.callTool({ name: "storyboard_model_tiers_set", arguments: { steps: { plan: "cheap" } } });
        const invalidRecord = await client.callTool({ name: "storyboard_model_tiers_set", arguments: { steps: { unknown: "cheap" } } });
        expect(defaults.isError).not.toBe(true);
        expect(defaults.content).toEqual([expect.objectContaining({ text: expect.stringContaining("\"discardWork\": false") })]);
        expect(validRecord.isError).not.toBe(true);
        expect(invalidRecord.isError).toBe(true);
        results.push({ tools, defaults, validRecord, invalidRecord });
      } finally {
        await client.close();
      }
    }
    expect(results[1]).toEqual(results[0]);
    expect(received).toHaveLength(2);
    expect(received[0]).toMatchObject({ steps: { plan: "cheap", verify: "cheap" } });
    expect(received[1]).toEqual(received[0]);
  } finally {
    await new Promise<void>((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
