import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../context.ts";
import { TOOL_ANNOTATIONS } from "../annotations.ts";
import { registerTasksTools } from "./tasks.ts";

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;

function setup(responses: { get?: unknown; post?: unknown; put?: unknown } = {}) {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _config: unknown, handler: Handler) => handlers.set(name, handler),
  } as unknown as McpServer;
  const get = vi.fn().mockResolvedValue(responses.get ?? {});
  const post = vi.fn().mockResolvedValue(responses.post ?? {});
  const put = vi.fn().mockResolvedValue(responses.put ?? {});
  registerTasksTools(server, { tasksStorage: {}, dashboard: { get, post, put } } as unknown as Context);
  const call = (name: string, args: Record<string, unknown> = {}) => handlers.get(name)!(args);
  return { call, get, post, put, has: (name: string) => handlers.has(name) };
}

afterEach(() => vi.unstubAllEnvs());

describe("implement reviewer tools", () => {
  it("registers all three, each with annotations", () => {
    const { has } = setup();
    for (const name of ["tasks_implement_review_settings_get", "tasks_implement_review_settings_set", "tasks_implement_review"]) {
      expect(has(name)).toBe(true);
      expect(TOOL_ANNOTATIONS[name]).toBeDefined();
    }
    expect(TOOL_ANNOTATIONS.tasks_implement_review_settings_get.readOnlyHint).toBe(true);
    expect(TOOL_ANNOTATIONS.tasks_implement_review.readOnlyHint).toBe(false);
  });

  it("reads the assigned reviewer, and says so when nobody is assigned", async () => {
    const assigned = setup({ get: { provider: "codex", model: "gpt-6-astra" } });
    expect((await assigned.call("tasks_implement_review_settings_get")).content[0].text).toBe("Implement reviewer: codex / gpt-6-astra");
    expect(assigned.get).toHaveBeenCalledWith("/api/tasks/implement/review-settings");
    const none = setup({ get: { provider: "", model: "" } });
    expect((await none.call("tasks_implement_review_settings_get")).content[0].text).toContain("the implementing agent reviews its own diff");
  });

  it("sets only what it was given", async () => {
    const { call, put } = setup({ put: { provider: "claude", model: "" } });
    expect((await call("tasks_implement_review_settings_set", { provider: "claude" })).content[0].text).toContain("claude (provider default model)");
    expect(put).toHaveBeenCalledWith("/api/tasks/implement/review-settings", { provider: "claude" });
  });

  it("refuses an empty set call", async () => {
    const { call, put } = setup();
    const result = await call("tasks_implement_review_settings_set", {});
    expect(result.isError).toBe(true);
    expect(put).not.toHaveBeenCalled();
  });

  it("starts the reviewer and forwards the caller's nesting depth", async () => {
    vi.stubEnv("DEVHUB_AGENT_DEPTH", "1");
    const { call, post } = setup({
      post: { run: { id: "run-abc", state: "running" }, reviewer: { provider: "codex", model: "gpt-6-astra" }, notePath: "pr-reviews/payments-api-pay-482" },
    });
    const args = { taskId: "task-1", date: "2026-10-07", cwd: "/Users/dev/wt", notePath: "pr-reviews/payments-api-pay-482", branch: "devhub/agent/pay-482" };
    const text = (await call("tasks_implement_review", args)).content[0].text;
    expect(text).toContain("Review started by codex / gpt-6-astra: run-abc (running).");
    expect(text).toContain('agent_wait(runId="run-abc")');
    expect(post).toHaveBeenCalledWith("/api/tasks/implement/review", { ...args, depth: 1 });
  });
});
