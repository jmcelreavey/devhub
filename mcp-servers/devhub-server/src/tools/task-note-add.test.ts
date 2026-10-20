import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../context.ts";
import { describe, expect, it, vi } from "vitest";
import { registerTasksTools } from "./tasks.ts";
import { TOOL_ANNOTATIONS } from "../annotations.ts";

describe("task_note_add", () => {
  function setup() {
    const tools = new Map<string, { handler: (input: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; structuredContent?: unknown; isError?: boolean }> }>();
    const server = { registerTool: (name: string, _config: unknown, handler: never) => tools.set(name, { handler }) } as unknown as McpServer;
    const post = vi.fn().mockResolvedValue({ saved: true, note: { id: "n1", at: "2026-10-19T10:00:00Z", text: "Keep API" }, capability: { running: true }, agent: { mode: "none" } });
    registerTasksTools(server, { tasksStorage: {}, dashboard: { post } } as unknown as Context);
    return { post, tools, add: tools.get("task_note_add")!.handler };
  }
  it("posts the new endpoint and preserves existing registrations", async () => {
    const { post, tools, add } = setup();
    const response = await add({ id: "PTF-1", text: "Keep API" });
    expect(post).toHaveBeenCalledWith("/api/tasks/note/add", { taskId: "PTF-1", text: "Keep API" });
    expect(response.content[0].text).toBe("Note saved to PTF-1");
    expect(response.structuredContent).toMatchObject({ saved: true, target: "PTF-1" });
    expect(tools.has("task_reopen")).toBe(true); expect(tools.has("tasks_update")).toBe(true);
    expect(TOOL_ANNOTATIONS.task_note_add).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
  });
  it("passes explicit update consent and a saved note id without re-appending", async () => {
    const { post, add } = setup();
    await add({ id: "t1", text: "Keep API", updateAgent: true, noteId: "n1" });
    expect(post).toHaveBeenCalledWith("/api/tasks/note/add", { taskId: "t1", text: "Keep API", updateAgent: true, noteId: "n1" });
  });
  it("reports dashboard errors", async () => {
    const { post, add } = setup(); post.mockRejectedValue(new Error("Handed off"));
    expect((await add({ id: "t1", text: "Keep API" })).isError).toBe(true);
  });
});
