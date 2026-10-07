/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useTaskAgentActions } from "./useTaskAgentActions";

const mocks = vi.hoisted(() => ({ start: vi.fn(), fetch: vi.fn(), error: vi.fn() }));
vi.mock("@/app/repos/useReposActions", () => ({ useReposActions: () => ({ openUpstart: mocks.start }) }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ error: mocks.error }) }));
vi.mock("@/lib/tasks/use-task-agent-runs", () => ({
  TASK_AGENT_RUNS_KEY: "/api/tasks/agent-runs/summary",
  useTaskAgentRuns: () => ({ latestRun: null, handoff: null }),
}));
vi.mock("@/components/EntityNoteAction", () => ({ useVaultNoteExists: () => true }));
vi.mock("@/components/tasks/ImplementTaskDialog", () => ({ ImplementTaskDialog: () => null }));
vi.mock("@/components/tasks/PlanTaskDialog", () => ({ PlanTaskDialog: () => null }));
vi.mock("@/components/tasks/ResumeTaskDialog", () => ({ ResumeTaskDialog: () => null }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

function setup(enabled = true, linked = true) {
  return renderHook(() => useTaskAgentActions({
    task: { id: "task-1", text: "Analytics overlay", done: false, createdAt: "",
      links: linked ? [{ kind: "repo", id: "acme/app", label: "app" }] : [] },
    date: "2026-09-24", enabled, onComplete: vi.fn(), onAbandon: vi.fn(),
  }));
}

it("keeps Upstart out of the status chip and launches the same task from its menu", async () => {
  const repo = { name: "app", path: "/repos/app" };
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ repo }) });
  vi.stubGlobal("fetch", mocks.fetch);
  const { result } = setup();
  expect(result.current.chip).toBeNull();
  expect(result.current.upstart).not.toBeNull();
  await act(async () => { await result.current.menuItems.find((item) => item.id === "upstart")!.onSelect(); });
  expect(mocks.fetch).toHaveBeenCalledWith("/api/repos/app");
  expect(mocks.start).toHaveBeenCalledWith(repo, false, undefined, "task-1");
});

it.each([[false, true], [true, false]])("does not offer startup for disabled or unlinked tasks (%s, %s)", (enabled, linked) => {
  const { result } = setup(enabled, linked);
  expect(result.current.upstart).toBeNull();
  expect(result.current.menuItems.some((item) => item.id === "upstart")).toBe(false);
});
