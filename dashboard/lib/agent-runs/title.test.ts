import { beforeEach, expect, it, vi } from "vitest";
const tasks = vi.hoisted(() => ({ getTasks: vi.fn() }));
vi.mock("@/lib/tasks/storage", () => tasks);
import { agentRunTitle } from "./title";

beforeEach(() => tasks.getTasks.mockReturnValue([{ id: "task", jiraKey: "PTF-5014", text: "PTF-5014 — Analytics overlay #analytics" }]));
it.each([["plan", "Plan"], ["implement", "Implement"], ["create-pr", "Create PR"]])("names %s from task metadata", (action, label) => {
  expect(agentRunTitle({ title: "Generic dialog", prompt: "Use the devhub skill", activity: { source: "interactive", action, taskId: "task", taskDate: "2026-09-24" } })).toBe(`${label} · PTF-5014 · Analytics overlay`);
});
it("preserves a descriptive caller title without a task", () => {
  expect(agentRunTitle({ title: "Create PR · app · Analytics overlay", prompt: "Use create-pr" })).toBe("Create PR · app · Analytics overlay");
});
it("falls back for a missing task and bounds long names", () => {
  tasks.getTasks.mockReturnValue([]);
  expect(agentRunTitle({ title: "Fallback", prompt: "Use skill", activity: { source: "interactive", action: "plan", taskId: "missing", taskDate: "2026-09-24" } })).toBe("Fallback");
  expect(agentRunTitle({ title: "a".repeat(100), prompt: "" })).toHaveLength(80);
});
