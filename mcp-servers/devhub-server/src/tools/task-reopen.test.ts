import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type { Context } from "../context.ts";
import { TOOL_ANNOTATIONS } from "../annotations.ts";
import { registerTasksTools } from "./tasks.ts";

function setup() {
  const tools = new Map<string, { schema: Record<string, { safeParse: (value: unknown) => { success: boolean } }>; handler: (input: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }> }>();
  const server = { registerTool: (name: string, config: { inputSchema: never }, handler: never) => tools.set(name, { schema: config.inputSchema, handler }) } as unknown as McpServer;
  const post = vi.fn().mockResolvedValue({ task: { id: "task-1", text: "Fix" }, column: "ready-for-review", alreadyOpen: false });
  registerTasksTools(server, { tasksStorage: {}, dashboard: { post } } as unknown as Context);
  return { tools, post, reopen: tools.get("task_reopen")! };
}

describe("task_reopen", () => {
  it("is additive, annotated and validates task IDs, tickets, reason and agent consent", () => {
    const { tools, reopen } = setup();
    expect(tools.has("tasks_update")).toBe(true);
    expect(tools.has("tasks_agent_resume")).toBe(true);
    expect(TOOL_ANNOTATIONS.task_reopen).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
    expect(reopen.schema.id.safeParse("PTF-123").success).toBe(true);
    expect(reopen.schema.id.safeParse("../task").success).toBe(false);
    expect(reopen.schema.addressFeedback.safeParse(true).success).toBe(true);
    expect(reopen.schema.reason.safeParse("x".repeat(401)).success).toBe(false);
  });
  it("calls the dashboard route rather than changing the local store", async () => {
    const { reopen, post } = setup();
    const args = { id: "PTF-123", reason: "New review", addressFeedback: true };
    const result = await reopen.handler(args);
    expect(post).toHaveBeenCalledExactlyOnceWith("/api/tasks/reopen", args);
    expect(result.content[0].text).toContain("reopened in ready-for-review");
  });
  it("reports no-op success and dashboard errors honestly", async () => {
    const { reopen, post } = setup();
    post.mockResolvedValueOnce({ alreadyOpen: true });
    expect((await reopen.handler({ id: "task-1" })).content[0].text).toContain("already open");
    post.mockRejectedValueOnce(new Error("No cached feedback"));
    expect((await reopen.handler({ id: "task-1", addressFeedback: true })).isError).toBe(true);
  });
});
