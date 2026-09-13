#!/usr/bin/env node
/**
 * Call one DevHub MCP tool from a shell, without an AI client in the loop.
 *
 *   node mcp-servers/devhub-server/scripts/call-tool.mjs --list
 *   node mcp-servers/devhub-server/scripts/call-tool.mjs notes_search '{"query":"lockfile"}'
 *
 * Spawns the real stdio server, so NOTES_DIR / DOCS_DIR / REPO_ROOT behave exactly as
 * they do when Claude Code or Codex launches it. Used by the README demo tape.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [tool, rawArgs = "{}"] = process.argv.slice(2);
if (!tool) {
  console.error("Usage: call-tool.mjs --list | <tool> ['<json args>']");
  process.exit(2);
}

let args;
try {
  args = JSON.parse(rawArgs);
} catch {
  console.error(`Arguments must be a JSON object, got: ${rawArgs}`);
  process.exit(2);
}

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const transport = new StdioClientTransport({
  command: path.join(serverDir, "node_modules", ".bin", "tsx"),
  args: [path.join(serverDir, "src", "mcp.ts")],
  cwd: serverDir,
  env: { ...process.env },
});
const client = new Client({ name: "devhub-call-tool", version: "1.0.0" });

await client.connect(transport);
try {
  if (tool === "--list") {
    const { tools } = await client.listTools();
    for (const t of tools) console.log(t.name);
    console.error(`${tools.length} tool(s)`);
  } else {
    const result = await client.callTool({ name: tool, arguments: args });
    for (const part of result.content ?? []) {
      if (part.type === "text") console.log(part.text);
    }
    if (result.isError) process.exitCode = 1;
  }
} finally {
  await client.close();
}
