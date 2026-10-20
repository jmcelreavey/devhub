import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../context.ts";
import { TOOL_ANNOTATIONS } from "../annotations.ts";
import { registerTasksTools } from "./tasks.ts";

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;

function setup(post: unknown = { run: { id: "run-1", state: "queued", providerLabel: "Claude" } }) {
  const tools = new Map<string, { config: { description?: string; inputSchema?: Record<string, { safeParse: (value: unknown) => { success: boolean } }> }; handler: Handler }>();
  const server = { registerTool: (name: string, config: never, handler: Handler) => tools.set(name, { config, handler }) } as unknown as McpServer;
  const send = vi.fn().mockResolvedValue(post);
  registerTasksTools(server, { tasksStorage: {}, dashboard: { get: vi.fn(), post: send, put: vi.fn() } } as unknown as Context);
  return { tools, send, call: (name: string, args: Record<string, unknown>) => tools.get(name)!.handler(args) };
}

afterEach(() => vi.unstubAllEnvs());

describe("tasks_agent_plan", () => {
  it("is additive: registered next to tasks_agent_resume, and the existing tools are untouched", () => {
    const { tools } = setup();
    expect(tools.has("tasks_agent_plan")).toBe(true);
    for (const name of ["tasks_agent_resume", "storyboard_start_auto", "tasks_set_stage"]) expect(TOOL_ANNOTATIONS[name]).toBeDefined();
    expect(TOOL_ANNOTATIONS.tasks_agent_plan).toEqual(TOOL_ANNOTATIONS.tasks_agent_resume);
    expect(TOOL_ANNOTATIONS.tasks_agent_plan.readOnlyHint).toBe(false);
  });

  it("describes itself as plan-only so a client can't mistake it for auto or implement", () => {
    const description = setup().tools.get("tasks_agent_plan")!.config.description!;
    expect(description).toContain("PLAN-ONLY");
    expect(description).toContain("read-only sandbox");
    expect(description).toContain("not guaranteed to be blocked");
    expect(description).toContain("never starts auto mode");
  });

  it("needs a task id and a day, and takes the optional agent choices", () => {
    const schema = setup().tools.get("tasks_agent_plan")!.config.inputSchema!;
    expect(schema.taskId.safeParse("task-1").success).toBe(true);
    expect(schema.taskId.safeParse("").success).toBe(false);
    expect(schema.date.safeParse("2026-10-12").success).toBe(true);
    expect(schema.date.safeParse("tomorrow").success).toBe(false);
    expect(Object.keys(schema).sort()).toEqual(["cwd", "date", "effort", "model", "origin", "provider", "taskId"]);
  });

  it("posts to the plan route with the caller's depth and reports the run", async () => {
    vi.stubEnv("DEVHUB_AGENT_DEPTH", "1");
    const { call, send } = setup();
    const result = await call("tasks_agent_plan", { taskId: "task-1", date: "2026-10-12", provider: "claude" });
    expect(send).toHaveBeenCalledExactlyOnceWith("/api/tasks/agent-runs/plan", { taskId: "task-1", date: "2026-10-12", provider: "claude", depth: 1 });
    expect(result.content[0].text).toBe("Started a plan-only run for task task-1 → run-1 · queued · Claude · stops after the plan; write restrictions depend on provider");
  });

  it("surfaces a dashboard refusal as an error instead of a started run", async () => {
    const { tools } = setup();
    const server = { registerTool: (name: string, _config: never, handler: Handler) => tools.set(name, { config: {}, handler }) } as unknown as McpServer;
    const send = vi.fn().mockRejectedValue(new Error("409: This task is already on auto, which plans it itself."));
    registerTasksTools(server, { tasksStorage: {}, dashboard: { get: vi.fn(), post: send, put: vi.fn() } } as unknown as Context);
    const result = await tools.get("tasks_agent_plan")!.handler({ taskId: "task-1", date: "2026-10-12" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("already on auto");
  });
});
