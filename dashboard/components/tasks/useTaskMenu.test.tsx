/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MODEL_TIERS } from "@/lib/storyboard/model-tiers-shared";
import { isValidElement } from "react";
import { Check, Link2 } from "lucide-react";
import { groupTaskMenu } from "./taskMenuGroups";
import { useTaskMenu, type TaskMenuHandlers } from "./useTaskMenu";
import { TaskItem } from "./TaskItem";
import type { Task } from "@/lib/tasks/types";
import type { TaskAgentRunRecord } from "@/lib/tasks/task-agent-runs";
import type { OrchestrationSummary } from "@/lib/storyboard/orchestration";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";

const state = vi.hoisted(() => ({
  latestRun: null as TaskAgentRunRecord | null, orchestration: null as OrchestrationSummary | null,
  push: vi.fn(), createNote: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn(),
  workCard: undefined as BoardCard | undefined, openTask: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("@/components/storyboard/TaskDetailProvider", () => ({ useTaskDetail: () => ({
  board: state.workCard ? { cards: [state.workCard], generatedAt: "2026-10-17T12:00:00Z" } : undefined,
  workflows: new Map<string, never>(), openTask: state.openTask, hrefForTask: (taskId: string) => `/?task=${taskId}`,
}) }));
vi.mock("swr", () => ({ mutate: vi.fn() }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ error: state.error, success: state.success, info: state.info }) }));
vi.mock("@/lib/create-vault-note", () => ({ createOrOpenVaultNote: state.createNote, vaultNoteHref: (notePath: string) => `/notes/${notePath}` }));
vi.mock("@/components/EntityNoteAction", () => ({ useVaultNoteExists: () => true }));
vi.mock("@/lib/hooks/use-tag-menu", () => ({ useTagMenuGroup: () => ({ group: null, modal: null, openModal: vi.fn() }), withTagsGroup: (groups: unknown[]) => groups }));
vi.mock("@/lib/tasks/use-task-agent-runs", () => ({ TASK_AGENT_RUNS_KEY: "/api/tasks/agent-runs/summary", useTaskAgentRuns: () => ({ latestRun: state.latestRun, handoff: null }) }));
vi.mock("@/lib/storyboard/use-orchestrations", () => ({ ORCHESTRATIONS_KEY: "/api/storyboard/orchestrate", useTaskOrchestration: () => state.orchestration }));
vi.mock("@/lib/storyboard/use-model-tiers", () => ({ useModelTiers: () => DEFAULT_MODEL_TIERS, saveModelTiers: vi.fn() }));
vi.mock("@/components/tasks/TaskUpstartButton", () => ({ useTaskUpstart: () => ({ busy: false, start: vi.fn() }), TaskUpstartButton: () => null }));
vi.mock("@/components/github/PrStatusMenu", () => ({ usePrStatusMenu: () => ({ bind: {}, menuNode: null }) }));
vi.mock("@/components/storyboard/AutoModeSwitch", () => ({ AutoModeSwitch: () => null, switchAutoMode: vi.fn() }));
vi.mock("@/components/tasks/ImplementTaskDialog", () => ({ ImplementTaskDialog: () => null }));
vi.mock("@/components/tasks/PlanTaskDialog", () => ({ PlanTaskDialog: () => null }));
vi.mock("@/components/tasks/ResumeTaskDialog", () => ({ ResumeTaskDialog: () => null }));
vi.mock("@/components/tasks/AddToJiraModal", () => ({ AddToJiraModal: () => null }));

const task: Task = { id: "task-menu", text: "A manual task", done: false, createdAt: "2026-10-17T09:00:00Z", startDate: "2026-10-17", rank: "a", links: [{ kind: "repo", id: "acme/app", label: "app" }], jiraKey: "APP-42" };
const handlers: TaskMenuHandlers = {
  onToggle: vi.fn(), onComplete: vi.fn(), onAbandon: vi.fn(), onDelete: vi.fn(), onEdit: vi.fn(), onStartEdit: vi.fn(),
  onTimer: vi.fn(), onAddToJira: vi.fn(), onReactivate: vi.fn(), onOpenNote: vi.fn(),
};
function setup(options: { inactive?: boolean; pending?: boolean; task?: Task } = {}) {
  return renderHook(() => useTaskMenu({ task, date: "2026-10-17", inactive: false, menuOpen: true, handlers, notePath: "task-notes/menu", ...options }));
}
beforeEach(() => { state.latestRun = null; state.orchestration = null; state.workCard = undefined; vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("shared task menu", () => {
  it.each(["draft", "ready", "merged", "closed", "attention", "abandoned", "done"] as const)("groups the %s menu and gives every action the shared icon treatment", (status) => {
    if (status === "merged" || status === "closed" || status === "attention") {
      state.latestRun = { runId: "run-1", status: "done", startedAt: "", updatedAt: "",
        prState: status === "attention" ? "open" : status,
        ...(status === "attention" ? { attention: { kind: "ci-failing" as const, key: "ci-failing", summary: "Checks failed", detectedAt: "" } } : {}),
      };
    }
    const { result } = renderHook(() => useTaskMenu({
      task: { ...task, stage: status === "draft" ? "draft" : undefined, done: status === "done", abandonedAt: status === "abandoned" ? "2026-10-17" : undefined },
      date: "2026-10-17", inactive: status === "abandoned", menuOpen: true,
      handlers: { ...handlers, onAddNote: vi.fn() },
      extraGroups: [{ id: "completion", items: [{ id: "complete", label: "Complete", icon: <Check size={12} aria-hidden />, onSelect: vi.fn() }] }],
    }));
    const groups = result.current.groups;
    expect(groups.map((group) => group.id)).toEqual(status === "abandoned" ? ["task", "danger"] : status === "done" ? ["task", "review", "jira", "danger"] : ["task", "agent", "review", "jira", "danger"]);
    expect(groups[0].items[0].id).toBe("complete");
    if (status === "draft") {
      expect(groups[0].items.map((item) => item.id)).toEqual(["complete", "edit", "add-note", "note", "timer", "upstart"]);
      expect(groups[1].items.map((item) => item.id)).toEqual(["plan-agent", "mark-ready", "start-auto", "start-auto-without-review", "start-auto-tiers"]);
    }
    for (const item of groups.flatMap((group) => group.items)) {
      expect(isValidElement(item.icon), item.id).toBe(true);
      if (isValidElement(item.icon)) expect(item.icon.props).toMatchObject({ size: 12, "aria-hidden": true });
    }
    expect(groups.at(-1)?.items.at(-1)?.id).toBe("delete");
    if (status === "closed") expect(groups.at(-1)?.items.map((item) => item.id)).toEqual(["abandon-closed", "abandon", "delete"]);
  });

  it("keeps caller groups and links before destructive actions without losing handlers", () => {
    const select = vi.fn();
    const item = (id: string) => ({ id, label: id, icon: <Link2 size={12} aria-hidden />, onSelect: select });
    const groups = groupTaskMenu([
      { id: "shared", items: ["delete", "note", "workflow", "start-auto", "open-jira"].map(item) },
      { id: "completion", items: [item("complete")] },
      { id: "failure", items: [item("failure-retry")] },
      { id: "tags", label: "Links", items: [item("view-tags")] },
      { id: "board", label: "Move", items: [item("move")] },
    ]);
    expect(groups.map((group) => group.id)).toEqual(["task", "agent", "recovery", "review", "jira", "tags", "board", "danger"]);
    expect(groups[0].items.map((entry) => entry.id)).toEqual(["complete", "note"]);
    expect(groups.flatMap((group) => group.items).every((entry) => entry.onSelect === select)).toBe(true);
  });

  it("puts Start on auto directly on eligible Today rows, with one request for two rapid clicks", async () => {
    state.workCard = {
      taskId: task.id, title: task.text, task, date: "2026-10-17", status: "todo", taskDone: false,
      notePath: "task-notes/menu", noteHref: "/notes/task-notes/menu", tags: [], links: [], models: [], summary: [],
      counts: { openQuestions: 0, openBugs: 0, blockerBugs: 0, decisions: 0 },
      screenshot: null, images: [], jev: null, tiers: null, run: null, steps: [], updatedAt: "2026-10-17T12:00:00Z", attention: null,
    };
    let respond!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { respond = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<TaskItem task={{ ...task, jiraKey: undefined }} date="2026-10-17" showStartAuto onToggle={handlers.onToggle} onAbandon={handlers.onAbandon} onDelete={handlers.onDelete!} onEdit={handlers.onEdit!} />);
    const start = screen.getByRole("button", { name: "Start on auto" });
    fireEvent.click(start);
    fireEvent.click(start);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(start).toBeDisabled();
    expect(fetchMock.mock.calls[0]).toMatchObject(["/api/storyboard/orchestrate", { method: "POST" }]);
    await act(async () => { respond(Response.json({ runId: "run-plan", summary: { status: "running" } })); });
    expect(state.openTask).toHaveBeenCalledExactlyOnceWith(task.id);
    expect(state.push).not.toHaveBeenCalled();
  });

  it("produces the manual task's note, launch, timer, Jira, edit and lifecycle actions", () => {
    const { result } = setup();
    expect(result.current.groups.flatMap((group) => group.items).map((item) => item.id)).toEqual(expect.arrayContaining([
      "note", "implement-agent", "start-auto", "timer", "open-jira", "edit", "generate-jira", "jira", "abandon", "delete", "workflow",
    ]));
    expect(result.current.groups.flatMap((group) => group.items).some((item) => item.id === "complete-merged")).toBe(false);
  });

  it("offers auto controls without a second Start for an auto task", () => {
    state.orchestration = { taskId: task.id, taskDate: task.startDate, status: "running", executionStep: "implement", runCount: 1, openQuestions: 0, updatedAt: "2026-10-17T10:00:00Z" };
    const { result } = setup();
    const items = result.current.groups.flatMap((group) => group.items);
    expect(items.some((item) => item.id === "start-auto")).toBe(false);
    expect(items.find((item) => item.id === "auto-mode")?.label).toBe("Switch to manual");
    expect(items.some((item) => item.id === "storyboard")).toBe(true);
  });

  it("offers explicit Finish for a merged task and invokes completion, never the checkbox toggle", async () => {
    state.latestRun = { runId: "run-1", status: "done", startedAt: "", updatedAt: "", prState: "merged" };
    const { result } = setup();
    const finish = result.current.groups.flatMap((group) => group.items).find((item) => item.id === "complete-merged")!;
    expect(finish.label).toBe("Finish");
    await act(async () => { await finish.onSelect(); });
    expect(handlers.onComplete).toHaveBeenCalledOnce();
    expect(handlers.onToggle).not.toHaveBeenCalled();
  });

  it.each(["queued", "running", "failed", "paused", "done"] as const)("doesn't offer a direct Start for an already %s task", (status) => {
    state.latestRun = { runId: "run-1", status, startedAt: "", updatedAt: "" };
    const { result } = setup();
    expect(result.current.agent.startAction).toBeUndefined();
  });

  it("disables pending actions and disables Finish with an explanation for a live run", () => {
    const { result, unmount } = setup({ pending: true });
    expect(result.current.groups.flatMap((group) => group.items).every((item) => item.disabled)).toBe(true);
    unmount();
    state.latestRun = { runId: "run-1", status: "running", startedAt: "", updatedAt: "", prState: "merged" };
    const live = setup();
    expect(live.result.current.groups.flatMap((group) => group.items).find((item) => item.id === "complete-merged")).toMatchObject({ disabled: true, disabledReason: expect.stringContaining("stop it first") });
  });

  it("keeps only safe actions for inactive tasks and doesn't offer launch or completion for done tasks", () => {
    const inactive = setup({ inactive: true });
    expect(inactive.result.current.groups.flatMap((group) => group.items).map((item) => item.id)).toEqual(["note", "open-jira", "delete"]);
    inactive.unmount();
    const done = setup({ task: { ...task, done: true } });
    expect(done.result.current.groups.flatMap((group) => group.items).some((item) => ["start-auto", "implement-agent", "complete-merged", "abandon"].includes(item.id))).toBe(false);
  });

  it("invokes the shared callbacks and opens the existing note through the caller's overlay", async () => {
    const { result } = setup();
    for (const id of ["note", "timer", "edit", "jira", "abandon", "delete", "workflow"]) {
      await act(async () => { await result.current.groups.flatMap((group) => group.items).find((item) => item.id === id)!.onSelect(); });
    }
    expect(handlers.onOpenNote).toHaveBeenCalledWith("task-notes/menu");
    expect(handlers.onTimer).toHaveBeenCalledOnce();
    expect(handlers.onStartEdit).toHaveBeenCalledOnce();
    expect(handlers.onAddToJira).toHaveBeenCalledOnce();
    expect(handlers.onAbandon).toHaveBeenCalledOnce();
    expect(handlers.onDelete).toHaveBeenCalledOnce();
    expect(state.push).toHaveBeenCalledWith(`/storyboard?task=${task.id}&taskSection=evidence`);
    expect(state.createNote).not.toHaveBeenCalled();
  });

  it("opens the task note in the Notes side panel instead of navigating when no overlay is supplied", async () => {
    state.createNote.mockResolvedValue({ path: "task-notes/menu", href: "/notes/task-notes/menu", wrote: false });
    const opened = vi.fn();
    window.addEventListener("devhub:notes-open-path", opened);
    const { result } = renderHook(() => useTaskMenu({ task, date: "2026-10-17", inactive: false, menuOpen: true, handlers: { ...handlers, onOpenNote: undefined }, notePath: "task-notes/menu" }));
    await act(async () => { await result.current.groups.flatMap((group) => group.items).find((item) => item.id === "note")!.onSelect(); });
    window.removeEventListener("devhub:notes-open-path", opened);
    expect((opened.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ path: "task-notes/menu" });
    expect(state.push).not.toHaveBeenCalled();
  });
});
