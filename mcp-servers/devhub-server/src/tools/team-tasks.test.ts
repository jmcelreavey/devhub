import { describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../context.ts";
import { TOOL_ANNOTATIONS } from "../annotations.ts";
import { registerTeamTaskTools } from "./team-tasks.ts";

function setup() {
  const handlers = new Map<string, (input: Record<string, unknown>) => Promise<unknown>>();
  const post = vi.fn(async () => ({ token: "confirmation" }));
  const server = { registerTool: (name: string, _config: unknown, handler: (input: Record<string, unknown>) => Promise<unknown>) => handlers.set(name, handler) } as unknown as McpServer;
  registerTeamTaskTools(server, { dashboard: { post } } as unknown as Context);
  return { handlers, post };
}
describe("team task tools", () => {
  it("adds both tools and routes asks through the shared dashboard path", async () => {
    const { handlers, post } = setup();
    expect([...handlers.keys()]).toEqual(["task_ask_teammate", "task_handoff"]);
    await handlers.get("task_ask_teammate")!({ taskId: "task-one", teammate: "helper", channel: "C1" });
    expect(post).toHaveBeenCalledWith("/api/team/collaboration", { action: "ask", taskId: "task-one", teammate: "helper", channel: "C1" });
    expect(TOOL_ANNOTATIONS.task_ask_teammate).toMatchObject({ readOnlyHint: false, destructiveHint: false });
  });
  it("only prepares a red owner confirmation for a handoff", async () => {
    const { handlers, post } = setup();
    await handlers.get("task_handoff")!({ taskId: "task-one", teammate: "U2", reassignJira: true, commitWip: false });
    expect(post).toHaveBeenCalledExactlyOnceWith("/api/team/collaboration", { action: "handoff", taskId: "task-one", teammate: "U2", reassignJira: true, commitWip: false, postConfirmation: true });
    expect(TOOL_ANNOTATIONS.task_handoff).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });
});

