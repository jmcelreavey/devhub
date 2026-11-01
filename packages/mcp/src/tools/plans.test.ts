import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import { taskCapture, taskPlanMarkdown, taskPrWatch, taskRetroInputs } from "../../../../packages/shared/actions/plans.ts";
import type { Context } from "../context.ts";
import { DashboardClient } from "../dashboard-client.ts";
import { registerPlanTools } from "./plans.ts";

describe("plan action contracts", () => {
  it("preserves capture, date and retro input bounds", () => {
    expect(taskCapture.input.parse({ text: " idea ", date: "2026-10-29" }).text).toBe("idea");
    expect(taskCapture.input.safeParse({ text: " " }).success).toBe(false);
    expect(taskPlanMarkdown.input.safeParse({ taskId: "task-1", date: "bad" }).success).toBe(false);
    expect(taskRetroInputs.input.safeParse({ days: 32 }).success).toBe(false);
  });

  it("does not dismiss a PR alert without both identifiers", async () => {
    const check = vi.fn().mockResolvedValue({ checked: 1, attention: 1, merged: 0, closed: 0 });
    const dismiss = vi.fn().mockResolvedValue(undefined);
    expect(await taskPrWatch.handler({ action: "dismiss", taskId: "task-1" }, { check, dismiss })).toEqual({ kind: "missing" });
    expect(dismiss).not.toHaveBeenCalled();
    expect(await taskPrWatch.handler({ action: "dismiss", taskId: "task-1", runId: "run-1" }, { check, dismiss })).toEqual({ kind: "dismissed", runId: "run-1" });
    expect(dismiss).toHaveBeenCalledWith("task-1", "run-1");
    expect(await taskPrWatch.handler({ action: "check" }, { check, dismiss })).toMatchObject({ kind: "checked", report: { checked: 1 } });
  });

  it("keeps the watch timeout and MCP output", async () => {
    const dashboard = new DashboardClient("http://localhost:1447");
    const post = vi.spyOn(dashboard, "post").mockResolvedValue({ checked: 2, attention: 1, merged: 1, closed: 0 });
    const handlers = new Map<string, (input: object) => Promise<{ content: Array<{ text?: string }> }>>();
    const server = { registerTool: (name: string, _config: object, handler: typeof handlers extends Map<string, infer Handler> ? Handler : never) => handlers.set(name, handler) };
    registerPlanTools(server as unknown as McpServer, { dashboard } as Context);
    const result = await handlers.get("tasks_pr_watch")!({ action: "check" });
    expect(post).toHaveBeenCalledWith("/api/tasks/pr-watch", {}, 120_000);
    expect(result.content[0].text).toContain("Checked 2 PR(s): 1 need a fix, 1 merged, 0 closed.");
  });
});
