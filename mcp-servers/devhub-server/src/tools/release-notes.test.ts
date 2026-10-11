import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { Context } from "../context.ts";
import type { DashboardToolResult } from "../dashboard-client.ts";
import { registerDocsTools } from "./docs.ts";

const temporary: string[] = [];
afterEach(() => { for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

function setup(source = "## Unreleased\n- Future\n## 2.0.5 — 2026-10-10\n- Latest\n## 2.0.4\n- Older") {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-notes-tool-"));
  temporary.push(repoRoot);
  fs.writeFileSync(path.join(repoRoot, "CHANGELOG.md"), source);
  const tools = new Map<string, (input: unknown) => Promise<DashboardToolResult>>();
  const annotations = new Map<string, unknown>();
  const server = { registerTool(name: string, config: { inputSchema?: z.ZodRawShape; annotations?: unknown }, handler: (input: unknown) => Promise<DashboardToolResult>) {
    annotations.set(name, config.annotations);
    tools.set(name, async (input) => handler(z.object(config.inputSchema ?? {}).strict().parse(input)));
  } };
  registerDocsTools(server as unknown as McpServer, { repoRoot } as Context);
  const handler = tools.get("release_notes_read");
  if (!handler) throw new Error("Release notes tool not registered in docs");
  return { call: (input: unknown = {}) => handler(input), repoRoot, annotations };
}

describe("release_notes_read", () => {
  it("is in the docs registry and reads headlessly with read-only annotations", async () => {
    const { call, annotations } = setup();
    const result = await call({ limit: 1 });
    expect(result.content[0]).toMatchObject({ text: "## 2.0.5 — 2026-10-10\n\n- Latest" });
    expect(annotations.get("release_notes_read")).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
  });
  it("selects exact versions and only includes Unreleased on request", async () => {
    const { call } = setup();
    expect((await call({ version: "v2.0.4" })).content[0]).toMatchObject({ text: "## 2.0.4\n\n- Older" });
    expect(JSON.stringify(await call({ includeUnreleased: true }))).toContain("Future");
    expect(JSON.stringify(await call({ version: "9.0.0" }))).toContain("No changelog entry");
  });
  it("rejects path-shaped and unbounded inputs", async () => {
    const { call } = setup();
    await expect(call({ version: "../../secret" })).rejects.toThrow();
    await expect(call({ limit: 0 })).rejects.toThrow();
    await expect(call({ limit: 51 })).rejects.toThrow();
    await expect(call({ path: "secrets" })).rejects.toThrow();
  });
  it("surfaces missing and malformed changelogs as errors", async () => {
    const missing = setup();
    fs.unlinkSync(path.join(missing.repoRoot, "CHANGELOG.md"));
    expect(await missing.call()).toMatchObject({ isError: true });
    expect(await setup("## 2.0.5\n- One\n## 2.0.5\n- Duplicate").call()).toMatchObject({ isError: true });
  });
});
