import { describe, expect, it } from "vitest";
import { instrumentToolHistory, summarizeMcpHistory, type McpHistoryEntry } from "./history.ts";
import { formatHistorySummary } from "./tools/history.ts";

function fakeServer() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const server = {
    registerTool(name: string, _config: unknown, cb: (...args: unknown[]) => unknown) {
      handlers.set(name, cb);
    },
    server: { getClientVersion: () => ({ name: "test-client", version: "1.0" }) },
  };
  return { server, handlers };
}

describe("instrumentToolHistory", () => {
  it("records successes, error results and thrown errors, but not history reads", async () => {
    const { server, handlers } = fakeServer();
    const recorded: McpHistoryEntry[] = [];
    instrumentToolHistory(server as never, {
      recorder: { record: (e) => recorded.push(e) },
      currentToolset: () => "notes",
    });

    server.registerTool("notes_write", { inputSchema: {} }, async () => ({ content: [{ type: "text", text: "saved" }] }));
    server.registerTool("status_services", {}, async () => ({ isError: true, content: [{ type: "text", text: "down\nmore" }] }));
    server.registerTool("boom", { inputSchema: {} }, async () => {
      throw new Error("kaput");
    });
    server.registerTool("mcp_history", { inputSchema: {} }, async () => ({ content: [] }));

    await handlers.get("notes_write")!({ path: "a", token: "secret" }, {});
    await handlers.get("status_services")!({});
    await expect(handlers.get("boom")!({}, {})).rejects.toThrow("kaput");
    await handlers.get("mcp_history")!({}, {});

    expect(recorded.map((e) => [e.tool, e.ok, e.error ?? null])).toEqual([
      ["notes_write", true, null],
      ["status_services", false, "down"],
      ["boom", false, "kaput"],
    ]);
    expect(recorded[0]).toMatchObject({
      toolset: "notes",
      args: { path: "a", token: "‹redacted›" },
      client: "test-client 1.0",
      resultChars: 5,
    });
    expect(recorded[1]?.args).toBeNull();
    expect(formatHistorySummary(summarizeMcpHistory("2026-09-14", recorded))).toContain("3 calls · 2 failed");
  });
});
