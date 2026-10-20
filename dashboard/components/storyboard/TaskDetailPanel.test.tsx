/** @vitest-environment jsdom */
import { useSyncExternalStore } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TASK_NOTE_STATUSES, TASK_NOTE_STATUS_LABEL } from "@shared/task-note/meta.ts";
import { readTaskNote } from "@shared/task-note/sections.ts";
import type { UpdateTaskNoteResult } from "@shared/task-note/update.ts";
import type { BoardCard, NotesBoard } from "@/lib/storyboard/notes-board-shared";
import type { OrchestrationSummary } from "@/lib/storyboard/orchestration";
import type { TaskWorkflowResponse } from "@/app/workflow/WorkflowEvidence";
import type { QaRunRecord } from "@/lib/qa/store";
import { jevInfoByTask } from "@/lib/qa/jev-summary";
import type { TaskProfileOverview } from "@/lib/tasks/profile-types";
import { TaskDetailPanel } from "./TaskDetailPanel";
import { TaskDetailProvider } from "./TaskDetailProvider";
import { TodayNeedsYou } from "@/components/today/TodayNeedsYou";
import { TaskItem } from "@/components/tasks/TaskItem";
import StoryboardClient from "@/app/storyboard/client";

const state = vi.hoisted(() => ({
  board: undefined as NotesBoard | undefined,
  workflow: undefined as TaskWorkflowResponse | undefined,
  note: undefined as UpdateTaskNoteResult | undefined,
  summaries: [] as OrchestrationSummary[],
  qa: [] as QaRunRecord[],
  profile: { mode: "profiles", active: "work", profiles: ["work", "home"], legacyFiles: 0, overlay: [] } as TaskProfileOverview,
  workflowError: undefined as Error | undefined,
  confirm: vi.fn(), refresh: vi.fn(), fetch: vi.fn(), close: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(useSyncExternalStore((notify) => {
    window.addEventListener("popstate", notify);
    window.addEventListener("task-test-url", notify);
    return () => { window.removeEventListener("popstate", notify); window.removeEventListener("task-test-url", notify); };
  }, () => window.location.search)),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/hooks/use-fetch", () => ({ defaultFetcher: vi.fn(), useLive: (key: string | null) => ({
  data: key?.startsWith("/api/storyboard") ? state.board
    : key === "/api/tasks/profiles" ? state.profile
    : key?.startsWith("/api/tasks/note/sections") ? state.note
    : key?.startsWith("/api/tasks/workflow?taskId=") ? state.workflow
    : key === "/api/tasks/workflow" || key?.startsWith("/api/tasks/workflow?taskProfile=") ? { items: [] }
    : key?.startsWith("/api/github/prs") ? { configured: true, authored: [], reviews: [], recentlyReviewed: [] }
    : key === "/api/qa" ? { runs: state.qa }
    : undefined,
  error: key?.startsWith("/api/tasks/workflow?taskId=") ? state.workflowError : undefined,
  mutate: state.refresh,
}) }));
vi.mock("@/lib/storyboard/use-orchestrations", () => ({
  ORCHESTRATIONS_KEY: "/api/storyboard/orchestrate",
  useOrchestrations: () => ({ data: { orchestrations: state.summaries, errors: [] }, mutate: state.refresh }),
}));
vi.mock("swr", () => ({ mutate: vi.fn(async (key, data) => { if (typeof key === "string" && key.startsWith("/api/tasks/note/sections") && data) state.note = data; }) }));
vi.mock("@/components/shell/ConfirmDialog", () => ({ useConfirm: () => state.confirm }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ success: state.success, error: state.error, info: state.info }) }));
vi.mock("@/components/vault/VaultEditorPage", () => ({ VaultEditorPage: ({ path, embedded, hideTaskQuestions }: { path: string[]; embedded: boolean; hideTaskQuestions: boolean }) => <div data-testid="shared-note-editor" data-embedded={embedded} data-hidden-questions={hideTaskQuestions}>{path.join("/")}</div> }));
vi.mock("@/components/tasks/useTaskMenu", () => ({ useTaskMenu: () => ({ agent: { chip: null }, groups: [], dialogs: null, noteExists: false, linkOpen: false, setLinkOpen: vi.fn(), openLinks: vi.fn(), openTaskNote: vi.fn() }) }));
vi.mock("@/components/tasks/useTaskAgentActions", () => ({ useTaskAgentActions: () => ({ menuItems: [], dialogs: null }) }));
vi.mock("@/app/storyboard/ModelTierPicker", () => ({ ModelTierPicker: () => null }));
vi.mock("@/app/storyboard/OrchestratorStatus", () => ({ OrchestratorStatus: () => null }));
vi.mock("@/components/agents/WorkingFolderField", () => ({ WorkingFolderField: ({ onChange, onPick }: { onChange: (value: { name: string; path: string }) => void; onPick: (value: { name: string; path: string }) => void }) => <><input aria-label="Working folder" onChange={() => onChange({ name: "app", path: "/repos/app" })} /><button onClick={() => onPick({ name: "app", path: "/repos/app" })}>Use app</button></> }));

function card(patch: Partial<BoardCard> = {}): BoardCard {
  return {
    taskId: "task-one", title: "Feed fallback", date: "2026-10-17", status: "todo", taskDone: false,
    notePath: "task-notes/task-one", noteHref: "/notes/task-notes/task-one", tags: [], links: [], models: [], repo: "app", jira: ["APP-42"], summary: ["Keep the previous result when the source is unavailable."],
    counts: { openQuestions: 0, openBugs: 0, blockerBugs: 0, decisions: 0 }, screenshot: null, images: [], jev: null, tiers: null, run: null, steps: [], attention: null, updatedAt: "2026-10-17T12:00:00Z", ...patch,
  };
}
function useCard(next: BoardCard) {
  state.board = { cards: [next], columns: TASK_NOTE_STATUSES.map((status) => ({ status, label: TASK_NOTE_STATUS_LABEL[status], count: status === next.status ? 1 : 0 })), hiddenDone: 0, generatedAt: next.updatedAt, errors: [] };
  state.workflow = { task: { id: next.taskId, text: next.title, date: next.date }, runs: [], workflow: { version: 1, taskId: next.taskId, revision: 1, seenRevision: 1, stage: "plan", status: "active", checks: [], reviews: [], proposals: [], events: [] } };
}
function panel() { return <TaskDetailPanel taskId="task-one" board={state.board} onClose={state.close} onRefresh={state.refresh} />; }
function taskRow() { return <TaskItem task={{ id: "task-one", text: "Feed fallback", done: false, startDate: "2026-10-17", createdAt: "", rank: "a" }} date="2026-10-17" showStartAuto onToggle={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} onAbandon={vi.fn()} />; }
function qaRun(): QaRunRecord {
  return { id: "qa-one", requestId: "qa-one", scenarioId: "feed", taskId: "task-one", state: "finished", createdAt: "2026-10-17T12:00:00Z", receipt: {
    schemaVersion: 1, id: "qa-one", scenarioId: "feed", title: "Feed QA", surface: "dom", status: "failed", startedAt: "2026-10-17T11:59:00Z", endedAt: "2026-10-17T12:00:00Z", stopReason: "Fallback assertion failed", goals: [], steps: [], errors: [], artifacts: [{ file: "after.png", kind: "image", phase: "after", sha256: "0".repeat(64) }, { file: "before.webm", kind: "video", phase: "before", sha256: "0".repeat(64) }, { file: "after.webm", kind: "video", phase: "after", sha256: "0".repeat(64) }], totals: { durationMs: 1000, inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0.01, unknownCostCalls: 0 },
  } };
}
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
  const push = window.history.pushState.bind(window.history);
  const replace = window.history.replaceState.bind(window.history);
  vi.spyOn(window.history, "pushState").mockImplementation((data, unused, url) => { push(data, unused, url); window.dispatchEvent(new Event("task-test-url")); });
  vi.spyOn(window.history, "replaceState").mockImplementation((data, unused, url) => { replace(data, unused, url); window.dispatchEvent(new Event("task-test-url")); });
  state.profile = { mode: "profiles", active: "work", profiles: ["work", "home"], legacyFiles: 0, overlay: [] };
  state.note = { notePath: "task-notes/task-one", created: false, changed: false, migrated: false, message: "Read", view: readTaskNote([]) };
  state.confirm.mockResolvedValue(true);
  state.summaries = [];
  state.qa = [];
  state.workflowError = undefined;
  useCard(card());
  state.fetch.mockImplementation(async () => Response.json({}));
  vi.stubGlobal("fetch", state.fetch);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("one task detail panel", () => {
  it("embeds the linked review note directly, with no summary blurb or open/hide button", async () => {
    useCard(card({ status: "ready-for-review", review: { gist: "Review ready", notes: "Read pr-reviews/app-42 for details.", runId: "review" } }));
    render(panel());
    expect(await screen.findByTestId("shared-note-editor")).toHaveTextContent("pr-reviews/app-42");
    expect(screen.queryByRole("button", { name: "Open review" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Hide review" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Review notes" })).toBeNull();
  });

  it("scopes re-running verification to the panel profile", async () => {
    useCard(card({ status: "ready-for-review" }));
    state.summaries = [{ taskId: "task-one", taskDate: "2026-10-17", status: "ready-for-review", executionStep: "verify", openQuestions: 0, runCount: 2, updatedAt: "", auto: { phase: "ready", round: 0, maxRounds: 2, runs: [] } }];
    render(panel());
    fireEvent.click(screen.getByRole("button", { name: "Re-run review" }));
    await waitFor(() => expect(state.fetch).toHaveBeenCalledOnce());
    expect(state.fetch.mock.calls[0][1].headers["X-Devhub-Task-Profile"]).toBe("work");
    expect(JSON.parse(state.fetch.mock.calls[0][1].body)).toMatchObject({ action: "rerun", taskId: "task-one", step: "review" });
  });

  it("confirms reset through the shared dialog and reports work that could not be discarded", async () => {
    useCard(card({ status: "in-progress", task: { id: "task-one", text: "Feed fallback", done: false, startDate: "2026-10-17", createdAt: "", rank: "a" } }));
    state.fetch.mockResolvedValue(Response.json({ reset: { keptCheckouts: ["/repos/app/shared"], leftBehind: ["PR remains open"] } }));
    render(panel());
    fireEvent.click(screen.getByText("Links, tiers and manual controls", { selector: "summary" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard work and reset" }));
    await waitFor(() => expect(state.info).toHaveBeenCalledWith(expect.stringContaining("Kept /repos/app/shared")));
    expect(state.confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: "Discard work and reset", variant: "danger" }));
    expect(state.fetch.mock.calls[0][1].headers["X-Devhub-Task-Profile"]).toBe("work");
    expect(state.success).not.toHaveBeenCalled();
  });

  it.each(["done", "abandoned", "handoff"] as const)("hides reset and re-run actions on %s tasks", (stateKind) => {
    useCard(card({ status: "ready-for-review", taskDone: stateKind === "done", task: { id: "task-one", text: "Feed fallback", done: stateKind === "done", startDate: "2026-10-17", createdAt: "", rank: "a", ...(stateKind === "abandoned" ? { abandonedAt: "2026-10-17T12:00:00Z" } : {}), ...(stateKind === "handoff" ? { handoff: { handoffId: "h1", toUserId: "U2", toName: "helper", status: "accepted" as const, expiresAt: 1 } } : {}) } }));
    state.summaries = [{ taskId: "task-one", taskDate: "2026-10-17", status: "ready-for-review", executionStep: "verify", openQuestions: 0, runCount: 2, updatedAt: "", auto: { phase: "ready", round: 0, maxRounds: 2, runs: [] } }];
    render(panel());
    fireEvent.click(screen.getByText("Checks, review and QA evidence", { selector: "summary" }));
    expect(screen.queryByRole("button", { name: /Re-run/ })).toBeNull();
    fireEvent.click(screen.getByText("Links, tiers and manual controls", { selector: "summary" }));
    expect(screen.queryByRole("button", { name: "Reset to To do" })).toBeNull();
  });
  it.each([
    ["todo", card(), "plan", "Start on auto"],
    ["question", card({ status: "needs-you", counts: { openQuestions: 1, openBugs: 0, blockerBugs: 0, decisions: 0 } }), "answer", "Answer"],
    ["repo", card({ notePath: null, noteHref: null, waitingOnRepo: true, attention: { reason: "awaiting", label: "Choose repo", action: { kind: "open", label: "Answer", href: "/storyboard?task=task-one" } } }), "repo", "Use app"],
    ["running", card({ status: "in-progress", run: { runId: "run-one", status: "running", startedAt: "2026-10-17T12:00:00Z" } }), "activity", "Open conversation"],
    ["failed", card({ status: "in-progress", run: { runId: "run-one", status: "failed", startedAt: "2026-10-17T12:00:00Z" } }), "evidence", "Retry"],
    ["review", card({ status: "ready-for-review", prUrl: "https://github.com/acme/app/pull/42" }), "evidence", "Open PR"],
    ["merged", card({ prState: "merged" }), "controls", "Finish"],
    ["manual", card({ status: "in-progress", auto: { status: "paused-manual", phase: "implement", label: "Manual", round: 0, maxRounds: 2 } }), "controls", "Done"],
  ] as const)("opens %s at the relevant section with one primary action", (_name, next, section, label) => {
    useCard(next);
    if (section === "answer") state.note!.view.questions = [{ id: "q1", text: "Keep the last result or fail?", resolved: false }];
    render(panel());
    const dialog = screen.getByRole("dialog", { name: "Task: Feed fallback" });
    if (section !== "answer" && section !== "repo") expect(dialog.querySelector(`[data-task-section="${section}"]`)).toHaveAttribute("open");
    const primary = within(dialog.querySelector("[data-task-primary]") as HTMLElement);
    expect([...primary.queryAllByRole("button").filter((button) => button.getAttribute("aria-label") !== "Auto options" && !["Copy Slack message", "Mark answered"].includes(button.textContent ?? "")), ...primary.queryAllByRole("link").filter((link) => !/^Answer in the plan note/.test(link.textContent ?? ""))]).toHaveLength(1);
    expect(primary.getByText(label)).toBeTruthy();
    if (section === "answer") expect(primary.getByRole("textbox")).toHaveFocus();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it("keeps publication approval in the guarded workflow UI and preserves stale findings", () => {
    state.workflow!.workflow.proposals = [{ id: "proposal", kind: "draft-pr", state: "pending", runId: "review", fingerprint: "abc", contentHash: "def", expiresAt: "2026-10-17T13:00:00Z", destination: "acme/app · ux", content: "Exact PR content" }];
    state.workflow!.workflow.checks = [{ id: "check", runId: "run", fingerprint: "abc", command: "npm run verify", startedAt: "2026-10-17T11:00:00Z", outcome: "passed", stale: true, exitCode: 0 }];
    state.workflow!.workflow.reviews = [{ runId: "review", fingerprint: "abc", findings: "Keep the stale-code guard", recordedAt: "2026-10-17T11:00:00Z", verdict: "pass", stale: true }];
    render(panel());
    expect(screen.getByRole("link", { name: "Review proposal" })).toHaveAttribute("href", "/workflow?taskId=task-one");
    expect(screen.getByText("Exact PR content")).toBeTruthy();
    expect(screen.getByText("Checks need to run again — code changed")).toBeTruthy();
    expect(screen.getByText("Review is out of date")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it("opens failed verification in Workflow even when the task also has a PR", () => {
    useCard(card({ status: "ready-for-review", prUrl: "https://github.com/acme/app/pull/42" }));
    state.workflow!.workflow.checks = [{ id: "check", runId: "run", fingerprint: "abc", command: "npm test", startedAt: "2026-10-17T11:00:00Z", outcome: "failed", exitCode: 1 }];
    render(panel());
    expect(within(screen.getByLabelText("Next action")).getByRole("link", { name: "Open workflow" })).toHaveAttribute("href", "/workflow?taskId=task-one");
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it("does not invent a retry or start action for an outside blocker", () => {
    useCard(card({ status: "blocked" }));
    render(panel());
    expect(screen.getByText("No action is waiting for you.")).toBeTruthy();
    const primary = screen.getByLabelText("Next action");
    expect(within(primary).queryByRole("button")).toBeNull();
    expect(within(primary).queryByRole("link")).toBeNull();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it("finishes once through the shared action and keeps its explicit Undo", async () => {
    useCard(card({ prState: "merged" }));
    let respond!: (response: Response) => void;
    state.fetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { respond = resolve; }));
    render(panel());
    const button = screen.getByRole("button", { name: "Finish" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(state.fetch).toHaveBeenCalledOnce());
    expect(button).toBeDisabled();
    expect(JSON.parse(state.fetch.mock.calls[0][1].body)).toEqual({ id: "task-one", completion: true, date: "2026-10-17" });
    await act(async () => { respond(Response.json({ done: true })); });
    const options = state.success.mock.calls.find(([message]) => message === "Task done.")?.[1];
    expect(options.action.label).toBe("Undo");
    await act(async () => { await options.action.onClick(); });
    expect(JSON.parse(state.fetch.mock.calls[1][1].body)).toEqual({ id: "task-one", completion: false, date: "2026-10-17" });
    expect(state.fetch.mock.calls.every(([url]) => url === "/api/tasks")).toBe(true);
  });

  it.each(["failure", "cap"] as const)("guards the panel's %s recovery action against rapid clicks", async (kind) => {
    useCard(card({ status: "needs-you", auto: { status: "needs-you", phase: "fix", label: "Fix", round: 2, maxRounds: 2, waiting: { kind, reason: kind === "cap" ? "2 fix rounds used; 1 blocker remains" : "Build failed" } }, counts: { openQuestions: 0, openBugs: 1, blockerBugs: 1, decisions: 0 } }));
    let respond!: (response: Response) => void;
    state.fetch.mockImplementation(() => new Promise<Response>((resolve) => { respond = resolve; }));
    render(panel());
    expect(screen.getByRole("dialog").querySelector('[data-task-section="evidence"]')).toHaveAttribute("open");
    expect(screen.getByText(/The orchestrator confirms the model at dispatch/)).toBeTruthy();
    const button = screen.getByRole("button", { name: kind === "cap" ? "One more round" : "Retry" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(state.fetch).toHaveBeenCalledOnce());
    expect(button).toBeDisabled();
    expect(JSON.parse(state.fetch.mock.calls[0][1].body)).toMatchObject({ action: "retry", taskId: "task-one" });
    await act(async () => { respond(Response.json({})); });
    await waitFor(() => expect(button).toBeEnabled());
  });

  it("uses the existing repo answer only on a deliberate selection and guards it once", async () => {
    useCard(card({ notePath: null, noteHref: null, waitingOnRepo: true, attention: { reason: "awaiting", label: "Choose repo", action: { kind: "open", label: "Answer", href: "/storyboard?task=task-one" } } }));
    let respond!: (response: Response) => void;
    state.fetch.mockImplementation(() => new Promise<Response>((resolve) => { respond = resolve; }));
    render(panel());
    fireEvent.change(screen.getByRole("textbox", { name: "Working folder" }), { target: { value: "app" } });
    expect(state.fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use app" }));
    fireEvent.click(screen.getByRole("button", { name: "Use app" }));
    await waitFor(() => expect(state.fetch).toHaveBeenCalledOnce());
    expect(JSON.parse(state.fetch.mock.calls[0][1].body)).toMatchObject({ action: "answer-repo", taskId: "task-one", taskDate: "2026-10-17", cwd: "/repos/app" });
    await act(async () => { respond(Response.json({})); });
    expect(state.refresh).toHaveBeenCalled();
  });

  it("records an answer once and waits for confirmed auto progress, without issuing a resume", async () => {
    useCard(card({ status: "needs-you", counts: { openQuestions: 1, openBugs: 0, blockerBugs: 0, decisions: 0 } }));
    state.note!.view.questions = [{ id: "q1", text: "Keep the last result or fail?", resolved: false }];
    state.summaries = [{ taskId: "task-one", taskDate: "2026-10-17", status: "needs-you", executionStep: "plan", runCount: 1, openQuestions: 1, updatedAt: "2026-10-17T12:00:00Z", auto: { phase: "plan", round: 0, maxRounds: 2, waiting: { kind: "questions", reason: "A question" }, runs: [{ runId: "plan", phase: "plan", round: 0 }] } }];
    let respond!: (response: Response) => void;
    state.fetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { respond = resolve; }));
    const view = render(panel());
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Keep the last result" } });
    fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Saving…" }));
    await waitFor(() => expect(state.fetch).toHaveBeenCalledOnce());
    expect(JSON.parse(state.fetch.mock.calls[0][1].body)).toEqual({ notePath: "task-notes/task-one", op: "resolve_question", id: "q1", answer: "Keep the last result" });
    const saved = { ...state.note!, view: { ...state.note!.view, questions: [{ id: "q1", text: "Keep the last result or fail?", resolved: true, answer: "Keep the last result" }] } };
    await act(async () => { respond(Response.json(saved)); });
    expect(await screen.findByText("Answer saved · resuming")).toBeTruthy();
    view.rerender(panel());
    expect(screen.queryByText("Answer saved · resumed")).toBeNull();
    state.summaries = [{ ...state.summaries[0], status: "paused", updatedAt: "2026-10-17T12:00:30Z", auto: { ...state.summaries[0].auto!, waiting: { kind: "failure", reason: "Agent unavailable" } } }];
    view.rerender(panel());
    expect(screen.getByText("Answer saved · resume needs attention")).toBeTruthy();
    state.summaries = [{ ...state.summaries[0], status: "paused-manual", updatedAt: "2026-10-17T12:00:45Z" }];
    view.rerender(panel());
    expect(screen.getByText("Answer saved · auto paused")).toBeTruthy();
    state.summaries = [{ ...state.summaries[0], status: "running", openQuestions: 0, updatedAt: "2026-10-17T12:01:00Z", auto: { ...state.summaries[0].auto!, phase: "implement", waiting: undefined } }];
    view.rerender(panel());
    expect(screen.getByText("Answer saved · resumed")).toBeTruthy();
    expect(state.fetch).toHaveBeenCalledOnce();
  });

  it("does not claim manual work resumed and never renders a second question form in the editor", async () => {
    useCard(card({ status: "needs-you", counts: { openQuestions: 1, openBugs: 0, blockerBugs: 0, decisions: 0 } }));
    state.note!.view.questions = [{ id: "q1", text: "Which fallback?", resolved: false }];
    state.fetch.mockImplementationOnce(async () => Response.json({ ...state.note!, view: { ...state.note!.view, questions: [{ id: "q1", text: "Which fallback?", resolved: true, answer: "Keep it" }] } }));
    render(panel());
    fireEvent.click(screen.getByText("Open note", { selector: "summary" }));
    expect(await screen.findByTestId("shared-note-editor")).toHaveAttribute("data-hidden-questions", "true");
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Keep it" } });
    fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    expect(await screen.findByText("Answer saved")).toBeTruthy();
    expect(screen.queryByText(/Answer saved · resum/)).toBeNull();
    expect(state.fetch).toHaveBeenCalledOnce();
  });

  it("reuses the receipt, media and deep links, and never paints a missing preview as passed", () => {
    state.qa = [qaRun()];
    const jev = jevInfoByTask(state.qa).get("task-one")!;
    useCard(card({ status: "ready-for-review", jev }));
    const view = render(panel());
    expect(screen.getByText("Fallback assertion failed")).toBeTruthy();
    expect(screen.getByRole("link", { name: "QA receipt" })).toHaveAttribute("href", "/qa?run=qa-one&task=task-one");
    expect(screen.getByRole("link", { name: "Before video" })).toHaveAttribute("href", "/api/qa/runs/qa-one/media/before.webm");
    expect(screen.getByRole("img", { name: /after screenshot/ })).toHaveAttribute("src", "/api/qa/runs/qa-one/media/after.png");
    useCard(card({ status: "ready-for-review", jev: { ...jev, status: "passed" }, auto: { phase: "ready", label: "Ready", round: 0, maxRounds: 2, noPreview: "No preview configured" } }));
    view.rerender(panel());
    expect(screen.getByText(/QA skipped — no preview/, { selector: ".tone-panel" })).toBeTruthy();
    expect(screen.queryByText("passed", { selector: ".badge-success" })).toBeNull();
    expect(screen.queryByText("Fallback assertion failed")).toBeNull();
  });

  it("keeps progress history, conversations, checkout and recorded costs together", () => {
    useCard(card({ status: "in-progress", run: { runId: "build", status: "running", startedAt: "2026-10-17T12:00:00Z" }, steps: [{ runId: "build", role: "implement", status: "running", tier: "mid", costUsd: 0.12 }] }));
    state.summaries = [{ taskId: "task-one", taskDate: "2026-10-17", status: "running", executionStep: "implement", openQuestions: 0, runCount: 2, updatedAt: "2026-10-17T12:00:00Z", checkout: { mode: "worktree", reason: "Keep main untouched" }, auto: { phase: "implement", round: 0, maxRounds: 2, runs: [{ runId: "plan", phase: "plan", round: 0, attempt: 0, at: "2026-10-17T11:00:00Z", tier: "mid" }, { runId: "build", phase: "implement", round: 0, attempt: 0, at: "2026-10-17T12:00:00Z", tier: "mid" }] } }];
    state.workflow!.runs = [{ runId: "build", cwd: "/repos/app/worktree", status: "running", startedAt: "2026-10-17T12:00:00Z", updatedAt: "2026-10-17T12:00:00Z" }];
    render(panel());
    expect(screen.getByLabelText("Phase history").querySelectorAll(":scope > li")).toHaveLength(2);
    expect(screen.getByText("/repos/app/worktree")).toBeTruthy();
    expect(screen.getByText(/≈\$0.12/, { selector: "summary" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open conversation" })).toHaveAttribute("href", "/agents?run=build");
  });

  it("does not hide unavailable workflow evidence behind a green or empty success state", () => {
    useCard(card({ status: "ready-for-review" }));
    state.workflow = undefined;
    state.workflowError = new Error("Offline");
    render(panel());
    expect(screen.getByText("Check evidence is unavailable. Refresh before relying on it.")).toBeTruthy();
    expect(screen.queryByText("No checks recorded yet.")).toBeNull();
  });

  it("invalidates the open detail on profile switching rather than acting on a different profile", () => {
    const view = render(panel());
    expect(screen.getByRole("button", { name: "Start on auto" })).toBeTruthy();
    state.profile = { ...state.profile, active: "home" };
    view.rerender(panel());
    expect(screen.getByRole("alert")).toHaveTextContent("opened in work");
    expect(screen.queryByRole("button", { name: "Start on auto" })).toBeNull();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it("uses the same panel for Today attention, Today rows and Storyboard titles and actions", async () => {
    useCard(card({ status: "ready-for-review" }));
    const today = render(<TaskDetailProvider><TodayNeedsYou />{taskRow()}</TaskDetailProvider>);
    const review = screen.getAllByRole("link", { name: "Review" })[0];
    fireEvent.click(review);
    const detail = await screen.findByRole("dialog", { name: "Task: Feed fallback" });
    expect(detail.querySelector('[data-task-section="evidence"]')).toHaveAttribute("open");
    expect(window.location.pathname).toBe("/");
    expect(new URLSearchParams(window.location.search).get("task")).toBe("task-one");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Feed fallback" }));
    expect(await screen.findByRole("dialog", { name: "Task: Feed fallback" })).toBeTruthy();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    today.unmount();
    act(() => window.history.replaceState(null, "", "/storyboard"));
    const storyboard = render(<StoryboardClient />);
    fireEvent.click(screen.getByRole("link", { name: "Feed fallback" }));
    expect(await screen.findByRole("dialog", { name: "Task: Feed fallback" })).toBeTruthy();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    storyboard.unmount();
    act(() => window.history.replaceState(null, "", "/storyboard"));
    render(<StoryboardClient />);
    fireEvent.click(screen.getByRole("link", { name: "Review" }));
    expect(await screen.findByRole("dialog", { name: "Task: Feed fallback" })).toBeTruthy();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it("only shows direct Start on auto on Today rows when the resolver allows it", () => {
    const view = render(<TaskDetailProvider>{taskRow()}</TaskDetailProvider>);
    expect(screen.getByRole("button", { name: "Start on auto" })).toBeTruthy();
    useCard(card({ status: "needs-you", counts: { openQuestions: 1, openBugs: 0, blockerBugs: 0, decisions: 0 } }));
    view.rerender(<TaskDetailProvider>{taskRow()}</TaskDetailProvider>);
    expect(screen.queryByRole("button", { name: "Start on auto" })).toBeNull();
    expect(screen.getByRole("link", { name: "Answer" })).toBeTruthy();
    useCard(card({ status: "in-progress", run: { runId: "build", status: "running", startedAt: "2026-10-17T12:00:00Z" } }));
    view.rerender(<TaskDetailProvider>{taskRow()}</TaskDetailProvider>);
    expect(screen.queryByRole("button", { name: "Start on auto" })).toBeNull();
    expect(screen.getByRole("link", { name: "View progress" })).toBeTruthy();
  });

  it("preserves filters and hashes through open, Escape, Back and Forward and restores focus", async () => {
    useCard(card({ status: "ready-for-review" }));
    window.history.replaceState(null, "", "/?tag=ux#legacy");
    render(<TaskDetailProvider><TodayNeedsYou /></TaskDetailProvider>);
    const trigger = screen.getByRole("link", { name: "Feed fallback" });
    expect(trigger).toHaveAttribute("href", "/?tag=ux&taskProfile=work&task=task-one#legacy");
    trigger.focus();
    fireEvent.click(trigger);
    const detail = await screen.findByRole("dialog");
    expect(window.location.search).toBe("?tag=ux&taskProfile=work&task=task-one");
    expect(window.location.hash).toBe("#legacy");
    const first = within(detail).getByRole("button", { name: "Close task details" });
    const last = within(detail).getByRole("link", { name: "Open in Notes" });
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
    const back = vi.spyOn(window.history, "back");
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(back).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).toHaveFocus();
    expect(window.location.search).toBe("?tag=ux");
    act(() => window.history.forward());
    expect(await screen.findByRole("dialog")).toBeTruthy();
    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(trigger);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByTestId("task-detail-backdrop"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it("opens a bookmark without a page hop and closes it by removing only detail URL state", async () => {
    window.history.replaceState(null, "", "/storyboard?repo=app&task=task-one&taskSection=note#legacy");
    render(<TaskDetailProvider><p>Board stays here</p></TaskDetailProvider>);
    expect(await screen.findByTestId("shared-note-editor")).toHaveAttribute("data-embedded", "true");
    const back = vi.spyOn(window.history, "back");
    fireEvent.click(screen.getByRole("button", { name: "Close task details" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(back).not.toHaveBeenCalled();
    expect(window.location.pathname + window.location.search + window.location.hash).toBe("/storyboard?repo=app#legacy");
  });

  it("uses the full viewport width on mobile without adding its own motion", () => {
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      matches: query === "(max-width: 767px)" || query === "(prefers-reduced-motion: reduce)",
      media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    }));
    render(panel());
    expect(screen.getByRole("dialog")).toHaveStyle({ left: "0px", right: "0px" });
    expect(screen.getByRole("dialog").style.width).toBe("");
    expect(screen.getByRole("dialog")).toHaveClass("side-panel-enter-mobile");
  });
});

it("shows milestone context and enlarges the latest screenshot with keyboard dismissal", () => {
  state.note!.view = readTaskNote([]);
  state.note!.view.summary = [[{ type: "text", text: "The new layout fits." }]];
  state.note!.view.statusUpdate = { summary: "The new layout fits.", whatChanged: "Reduced card clutter.", currentState: "Checks passed.", nextStep: "Review the screenshot." };
  state.note!.view.latestScreenshot = { id: "shot", kind: "image", url: "/api/notes/assets/test.png", caption: "Updated task panel", name: "test.png" };
  render(panel());
  const context = screen.getByRole("region", { name: "Task summary" });
  expect(within(context).getByText("The new layout fits.")).toBeVisible();
  expect(within(context).getByText("Reduced card clutter.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Enlarge latest screenshot" }));
  const viewer = screen.getByRole("dialog", { name: "Latest task screenshot" });
  expect(viewer).toBeVisible();
  fireEvent.keyDown(viewer, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "Latest task screenshot" })).toBeNull();
  expect(state.close).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Enlarge latest screenshot" })).toHaveFocus();
});

it("shows a useful fallback when the latest screenshot cannot load", () => {
  state.note!.view.latestScreenshot = { id: "gone", kind: "image", url: "/missing.png", caption: "Missing capture", name: "missing.png" };
  render(panel());
  fireEvent.error(screen.getByRole("img", { name: "Missing capture" }));
  expect(screen.getByRole("button", { name: "Enlarge latest screenshot" })).toHaveTextContent("Screenshot unavailable");
});

it("keeps Open review consistent with the card and opens notes in place without toggling them shut", () => {
  useCard(card({ status: "ready-for-review", review: { gist: "Check the focus", notes: "Check the focus before publishing.", runId: "review" } }));
  render(panel());
  const action = within(screen.getByLabelText("Next action")).getByRole("button", { name: "Open review" });
  fireEvent.click(action);
  expect(screen.getByText("Check the focus before publishing.")).toBeVisible();
  fireEvent.click(action);
  expect(screen.getByText("Check the focus before publishing.")).toBeVisible();
  expect(state.fetch).not.toHaveBeenCalled();
});

it("shows review notes once beside the primary action while retaining the independent verdict", () => {
  const findings = "Check focus before publishing.";
  useCard(card({ status: "ready-for-review", review: { gist: findings, notes: findings, runId: "review" } }));
  state.workflow!.workflow.reviews = [{ runId: "review", fingerprint: "fixture", findings, verdict: "changes-requested", recordedAt: "2026-10-17T11:00:00Z", stale: false }];
  render(panel());
  expect(screen.getAllByText(findings, { exact: true })).toHaveLength(1);
  expect(within(screen.getByLabelText("Next action")).getByText(findings)).toBeVisible();
  expect(screen.getByText("Changes requested", { exact: true })).toBeVisible();
});

it("keeps failure recovery ahead of cached review notes when a newer failure arrives", () => {
  useCard(card({ status: "ready-for-review", review: { gist: "Old review", notes: "Old review", runId: "review" } }));
  state.workflow!.workflow.reviews = [{ runId: "review", fingerprint: "fixture", findings: "Old review", verdict: "changes-requested", recordedAt: "2026-10-17T10:00:00Z", stale: false }];
  const view = render(panel());
  expect(screen.getByRole("button", { name: "Open review" })).toBeVisible();
  state.board!.cards[0] = { ...state.board!.cards[0], failure: { key: "new-failure", summary: "Implementation timed out", runId: "failed" }, run: { runId: "failed", role: "implement", status: "failed", startedAt: "2026-10-17T11:00:00Z" } };
  view.rerender(panel());
  expect(screen.getByRole("button", { name: "Clear failure" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Open review" })).toBeNull();
  expect(within(screen.getByLabelText("Next action")).queryByText("Old review")).toBeNull();
});
