/** @vitest-environment jsdom */
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useTaskAgentActions } from "./useTaskAgentActions";

const mocks = vi.hoisted(() => ({
  start: vi.fn(), fetch: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn(), push: vi.fn(),
  orchestration: null as null | Record<string, unknown>,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/app/repos/useReposActions", () => ({ useReposActions: () => ({ openUpstart: mocks.start }) }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ error: mocks.error, success: mocks.success, info: mocks.info }) }));
vi.mock("@/lib/storyboard/use-orchestrations", () => ({
  ORCHESTRATIONS_KEY: "/api/storyboard/orchestrate",
  useTaskOrchestration: () => mocks.orchestration,
}));
vi.mock("@/lib/tasks/use-task-agent-runs", () => ({
  TASK_AGENT_RUNS_KEY: "/api/tasks/agent-runs/summary",
  useTaskAgentRuns: () => ({ latestRun: null, handoff: null }),
}));
vi.mock("@/components/EntityNoteAction", () => ({ useVaultNoteExists: () => true }));
vi.mock("@/components/tasks/ImplementTaskDialog", () => ({ ImplementTaskDialog: () => null }));
vi.mock("@/components/tasks/PlanTaskDialog", () => ({ PlanTaskDialog: () => null }));
vi.mock("@/components/tasks/ResumeTaskDialog", () => ({ ResumeTaskDialog: () => null }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); mocks.orchestration = null; });

function setup(enabled = true, linked = true, onAutoStarted?: () => void) {
  return renderHook(() => useTaskAgentActions({
    task: { id: "task-1", text: "Analytics overlay", done: false, createdAt: "", startDate: "2026-10-01", rank: "1",
      links: linked ? [{ kind: "repo", id: "acme/app", label: "app" }] : [] },
    date: "2026-09-24", enabled, onComplete: vi.fn(), onAbandon: vi.fn(), onAutoStarted,
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

const summary = (status: string, extra: Record<string, unknown> = {}) => ({
  taskId: "task-1", status, executionStep: "plan", openQuestions: 0, runCount: 1, updatedAt: "2026-10-15T09:00:00.000Z", ...extra,
});

it("starts a task on auto, then opens Storyboard scoped to it", async () => {
  mocks.fetch.mockResolvedValue({ ok: true, status: 201, json: async () => ({ created: true, runId: "run-plan", summary: summary("running") }) });
  vi.stubGlobal("fetch", mocks.fetch);
  const { result } = setup();
  const start = result.current.menuItems.find((item) => item.id === "start-auto-without-review");
  expect(start?.label).toBe("Run without plan review");
  await act(async () => { await start!.onSelect(); });
  const [url, init] = mocks.fetch.mock.calls[0];
  expect(url).toBe("/api/storyboard/orchestrate");
  const body = JSON.parse(init.body);
  expect(body).toMatchObject({ action: "start", taskId: "task-1", taskDate: "2026-09-24", pauseAfterPlan: false });
  expect(body.idempotencyKey).toMatch(/^[a-zA-Z0-9_-]{8,80}$/);
  expect(mocks.push).toHaveBeenCalledWith("/storyboard?task=task-1");
  expect(mocks.success).toHaveBeenCalledWith("On auto: planning started");
});

it("offers running without plan review as a shared menu option", async () => {
  mocks.fetch.mockResolvedValue({ ok: true, status: 201, json: async () => ({ created: true }) });
  vi.stubGlobal("fetch", mocks.fetch);
  const { result } = setup();
  const option = result.current.menuItems.find((item) => item.id === "start-auto-without-review")!;
  expect(option.label).toBe("Run without plan review");
  await act(async () => { await option.onSelect(); });
  expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toMatchObject({ pauseAfterPlan: false });
});

it("reports a network failure and lets the user retry", async () => {
  mocks.fetch.mockRejectedValueOnce(new Error("Network request failed"));
  vi.stubGlobal("fetch", mocks.fetch);
  const { result } = setup();
  await act(async () => { await result.current.menuItems.find((item) => item.id === "start-auto-without-review")!.onSelect(); });
  expect(mocks.error).toHaveBeenCalledWith("Couldn't reach DevHub. Refresh before retrying.");
  expect(result.current.menuItems.find((item) => item.id === "start-auto")?.disabled).toBe(false);
  expect(mocks.push).not.toHaveBeenCalled();
});

it("keeps a task detail launch on the current page when its caller handles the result", async () => {
  mocks.fetch.mockResolvedValue({ ok: true, status: 201, json: async () => ({ created: true, runId: "run-plan", summary: summary("running") }) });
  vi.stubGlobal("fetch", mocks.fetch);
  const onAutoStarted = vi.fn();
  const { result } = setup(true, true, onAutoStarted);
  await act(async () => { await result.current.menuItems.find((item) => item.id === "start-auto-without-review")!.onSelect(); });
  expect(onAutoStarted).toHaveBeenCalledOnce();
  expect(mocks.push).not.toHaveBeenCalled();
});

it("reports a refused start without navigating", async () => {
  mocks.fetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "That task is closed." }) });
  vi.stubGlobal("fetch", mocks.fetch);
  const { result } = setup();
  await act(async () => { await result.current.menuItems.find((item) => item.id === "start-auto-without-review")!.onSelect(); });
  expect(mocks.error).toHaveBeenCalledWith("That task is closed.");
  expect(mocks.push).not.toHaveBeenCalled();
});

it("shows an On auto chip and drops Start on auto while orchestrating", () => {
  mocks.orchestration = summary("running");
  const { result } = setup();
  expect(result.current.menuItems.some((item) => item.id === "start-auto")).toBe(false);
  expect(result.current.menuItems.some((item) => item.id === "storyboard")).toBe(true);
  const { getByRole } = render(<>{result.current.chip}</>);
  expect(getByRole("link", { name: /On auto — open on Storyboard/ }).getAttribute("href")).toBe("/storyboard?task=task-1");
});

it.each([["needs-you", "Needs you"], ["pr-created", "PR ready"]])("labels the chip for %s", (status, label) => {
  mocks.orchestration = summary(status, { openQuestions: 1 });
  const { result } = setup();
  const { getByRole } = render(<>{result.current.chip}</>);
  expect(getByRole("link", { name: new RegExp(label) })).toBeTruthy();
});

it("confirms planning started when a retry finally dispatches", async () => {
  mocks.orchestration = summary("paused", { runCount: 0 });
  mocks.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ created: false, runId: "run-retry", summary: summary("running") }) });
  vi.stubGlobal("fetch", mocks.fetch);
  const { result } = setup();
  await act(async () => { await result.current.menuItems.find((item) => item.id === "start-auto-without-review")!.onSelect(); });
  expect(mocks.success).toHaveBeenCalledWith("On auto: planning started");
});

it("offers a retry when the start never got a run", () => {
  mocks.orchestration = summary("needs-you", { runCount: 0, openQuestions: 1 });
  const { result } = setup();
  expect(result.current.menuItems.find((item) => item.id === "start-auto")?.label).toBe("Retry on auto");
});

it("opens the launch sheet for Start on auto instead of starting at once", async () => {
  vi.stubGlobal("fetch", mocks.fetch);
  const { result } = setup();
  await act(async () => { await result.current.menuItems.find((item) => item.id === "start-auto")!.onSelect(); });
  // Nothing is sent until the sheet is submitted, so the model, instructions and worktree can change first.
  expect(mocks.fetch).not.toHaveBeenCalled();
});
