/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardCard, NotesBoard } from "@/lib/storyboard/notes-board-shared";
import type { WorkflowInboxResponse } from "@/lib/workflows/inbox";
import type { GithubPrsApiPayload } from "@/lib/github/prs";
import type { TaskProfileOverview } from "@/lib/tasks/profile-types";
import type { TaskAgentRunSummaries } from "@/lib/tasks/task-agent-runs";
import { HomePage, HomeWorkSummary } from "./HomeWorkSummary";
import HomeLoading from "@/app/loading";

const state = vi.hoisted(() => ({
  runs: {} as TaskAgentRunSummaries,
  active: "work", profileLoading: false, profileError: undefined as Error | undefined, query: "", replace: vi.fn(), teamLinked: false,
  boards: {} as Record<string, NotesBoard | undefined>, inboxes: {} as Record<string, WorkflowInboxResponse | undefined>, prs: {} as Record<string, GithubPrsApiPayload | undefined>,
  boardError: undefined as Error | undefined, inboxError: undefined as Error | undefined, githubError: undefined as Error | undefined,
  live: vi.fn(), refreshBoard: vi.fn(), refreshInbox: vi.fn(), refreshPrs: vi.fn(), refreshProfile: vi.fn(), mutate: vi.fn(), fetch: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn(), openTask: vi.fn(), openPr: vi.fn(),
}));
vi.mock("@/lib/hooks/use-fetch", () => ({ useLive: state.live, defaultFetcher: vi.fn() }));
vi.mock("@/lib/tickers", () => ({ useMinuteTick: () => Date.parse("2026-10-18T12:00:00Z") }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ success: state.success, error: state.error, info: state.info }) }));
vi.mock("swr", () => ({ mutate: state.mutate, default: () => ({ data: undefined }) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(state.query), useRouter: () => ({ replace: state.replace }) }));
vi.mock("@/components/storyboard/TaskDetailProvider", () => ({
  TaskDetailProvider: ({ children }: { children: ReactNode }) => children,
  useTaskDetail: () => ({ openTask: state.openTask, openPr: state.openPr, hrefForTask: (id: string) => `/?task=${id}&taskProfile=${state.active}`, hrefForPr: () => `/?pr=acme%2Fapp%2342&taskProfile=${state.active}` }),
}));
vi.mock("@/components/tasks/ResumeTaskDialog", () => ({ ResumeTaskDialog: ({ open }: { open: boolean }) => open ? <div role="dialog" aria-label="Resume task agent" /> : null }));
vi.mock("@/components/jira/JiraStatusPill", () => ({ JiraStatusPill: ({ status }: { status: string }) => <button>{status}</button> }));

function card(taskId: string, patch: Partial<BoardCard> = {}): BoardCard {
  return { taskId, title: `Task ${taskId}`, date: "2026-10-18", status: "todo", taskDone: false, notePath: `task-notes/${taskId}`, noteHref: `/notes/task-notes/${taskId}`, tags: [], links: [], models: [], summary: [], counts: { openQuestions: 0, openBugs: 0, blockerBugs: 0, decisions: 0 }, images: [], screenshot: null, jev: null, tiers: null, run: null, steps: [], attention: null, updatedAt: "2026-10-18T11:59:00Z", ...patch };
}
function board(cards: BoardCard[]): NotesBoard { return { cards, columns: [], generatedAt: "2026-10-18T12:00:00Z", hiddenDone: 0, errors: [] }; }
function overview(): TaskProfileOverview { return { active: state.active, mode: "profiles", profiles: ["work", "home"], legacyFiles: 0, overlay: [] }; }
function section(name: string) { return screen.getByRole("region", { name }); }

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  state.active = "work"; state.profileLoading = false; state.profileError = undefined; state.query = ""; state.teamLinked = false;
  state.boards = { work: board([]), home: board([]) };
  state.inboxes = { work: { items: [] }, home: { items: [] } };
  state.prs = { work: { configured: true, authored: [], reviews: [], recentlyReviewed: [], generatedAt: "2026-10-18T11:58:00Z" }, home: { configured: true, authored: [], reviews: [], recentlyReviewed: [] } };
  state.runs = {};
  state.boardError = undefined; state.inboxError = undefined; state.githubError = undefined;
  state.fetch.mockImplementation(async () => Response.json({ task: { id: "captured", stage: "draft" } }, { status: 201 }));
  vi.stubGlobal("fetch", state.fetch);
  state.live.mockImplementation((key: string | null) => {
    if (key === "/api/tasks/profiles") return { data: state.profileLoading ? undefined : overview(), error: state.profileError, mutate: state.refreshProfile };

    const url = key ? new URL(key, "http://localhost") : null;
    const scope = url?.searchParams.get("taskProfile") ?? "";
    if (url?.pathname === "/api/tasks/agent-runs/summary") return { data: { tasks: state.runs }, mutate: vi.fn() };
    if (url?.pathname === "/api/team/collaboration") return { data: { linked: state.teamLinked, online: true, members: [{ userId: "U2", userName: "helper" }] }, mutate: vi.fn() };
    if (url?.pathname === "/api/calendar") return { data: { events: [] }, mutate: vi.fn() };
    if (url?.pathname === "/api/own") return { data: { repos: [{ fullName: "acme/app" }] }, mutate: vi.fn() };
    if (url?.pathname === "/api/repos/worktree-cleanup") return { data: { rows: [], failedRepos: [] }, mutate: vi.fn() };
    if (url?.pathname === "/api/jira/tickets") return { data: { configured: true, tickets: [] }, mutate: vi.fn() };
    if (url?.pathname === "/api/github/prs/owned") return { data: { prs: [], failedRepos: [] }, mutate: vi.fn() };
    if (url?.pathname === "/api/storyboard") return { data: state.boards[scope], error: state.boardError, mutate: state.refreshBoard };
    if (url?.pathname === "/api/tasks/workflow") return { data: state.inboxes[scope], error: state.inboxError, mutate: state.refreshInbox };
    if (url?.pathname === "/api/github/prs") return { data: state.prs[scope], error: state.githubError, mutate: state.refreshPrs };
    return { data: undefined, mutate: vi.fn() };
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Unified Home", () => {
  it.each([
    { tab: "Repo", endpoint: "/api/repos", data: { repos: [{ name: "app", branch: "main" }] }, option: "app", ref: { kind: "repo", id: "app", label: "app" } },
    { tab: "PR", endpoint: "/api/github/prs", data: { configured: true, authored: [{ repo: "acme/app", number: 42, url: "https://github.com/acme/app/pull/42", title: "Fix audio" }] }, option: "Fix audio", ref: { kind: "pr", id: "acme/app#42", label: "Fix audio", href: "https://github.com/acme/app/pull/42" } },
    { tab: "Note", endpoint: "/api/tree", data: [{ type: "file", name: "Plan.json", path: "plans/Plan.json" }], option: "Plan", ref: { kind: "note", id: "plans/Plan", label: "Plan", href: "/notes/plans/Plan" } },
    { tab: "Task", endpoint: "/api/tasks/history?includeTasks=1", data: [{ date: "2026-10-18", tasks: [{ id: "related-task", text: "Related task", done: false }] }], option: "Related task", ref: { kind: "task", id: "related-task", label: "Related task", href: "/work?tab=tasks" } },
  ])("opens the $tab picker from a Home task's links modal and saves to its profile", async ({ tab, endpoint, data, option, ref }) => {
    const task = { id: "link-task", text: "Link regression task", done: false, startDate: "2026-10-18", createdAt: "", rank: "a" };
    state.boards.work = board([card(task.id, { task, title: task.text })]);
    const live = state.live.getMockImplementation()!;
    state.live.mockImplementation((key: string | null) => {
      if (key?.startsWith("/api/entity-links?")) return { data: { related: [] } };
      if (key === endpoint) return { data };
      if (key === "/api/repos") return { data: { repos: [] } };
      return live(key);
    });
    render(<HomeWorkSummary />);
    fireEvent.contextMenu(screen.getByRole("article", { name: task.text }), { clientX: 20, clientY: 20 });
    fireEvent.click(document.querySelector('[data-menu-item="view-tags"]')!);
    expect(screen.getByText("Nothing linked yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add link…" }));
    expect(screen.getByRole("tablist", { name: "Link type" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: tab }));
    fireEvent.click(screen.getByRole("option", { name: new RegExp(option) }));
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    await waitFor(() => expect(state.fetch).toHaveBeenCalledWith("/api/tasks", expect.objectContaining({
      method: "PATCH",
      headers: expect.objectContaining({ "X-Devhub-Task-Profile": "work" }),
      body: JSON.stringify({ id: task.id, date: task.startDate, links: [ref] }),
    })));
    await waitFor(() => expect(screen.queryByRole("tablist", { name: "Link type" })).toBeNull());
  });

  it("shows unresolved failures instead of a healthy resume chip", () => {
    const task = { id: "failed-chip", text: "Task failed-chip", done: false, startDate: "2026-10-18", createdAt: "", rank: "a" };
    state.boards.work = board([card(task.id, { task, status: "in-progress", failure: { key: "failed-run", summary: "Typecheck failed" }, run: { runId: "failed-run", status: "failed", startedAt: "" } })]);
    state.runs[task.id] = { handoff: "", latestRun: { runId: "failed-run", status: "failed", startedAt: "", updatedAt: "" } };
    render(<HomeWorkSummary />);
    const row = screen.getByRole("article", { name: task.text });
    expect(within(row).getByText("Failed · Typecheck failed").closest(".sr-only")).toBeNull();
    expect(row).toHaveAttribute("data-failed", "true");
    expect(within(row).queryByText("Ready to resume")).toBeNull();
    expect(within(row).getByRole("button", { name: "Retry" })).toBeEnabled();
  });

  it("keeps a live agent chip without a duplicate View progress action", () => {
    const task = { id: "live-chip", text: "Task live-chip", done: false, startDate: "2026-10-18", createdAt: "", rank: "a" };
    const run = { runId: "live", status: "running" as const, startedAt: "2026-10-18T11:59:00Z", updatedAt: "2026-10-18T11:59:00Z" };
    state.boards.work = board([card(task.id, { task, status: "in-progress", run })]);
    state.runs[task.id] = { handoff: "", latestRun: run };
    render(<HomeWorkSummary />);
    const row = within(screen.getByRole("article", { name: task.text }));
    expect(row.getByRole("link", { name: "Running — open agent chat" })).toBeInTheDocument();
    expect(row.queryByRole("link", { name: "View progress" })).toBeNull();
  });

  it("opens Add note from the menu and returns focus there when cancelled", async () => {
    state.boards.work = board([card("note")]);
    render(<HomeWorkSummary />);
    const row = within(screen.getByRole("article", { name: "Task note" }));
    expect(row.queryByRole("button", { name: "Add note" })).toBeNull();
    const trigger = row.getByRole("button", { name: "Actions for Task note" });
    fireEvent.click(trigger);
    fireEvent.click(document.querySelector('[data-menu-item="add-note"]')!);
    const input = await screen.findByRole("textbox", { name: "Note for Task note" });
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("textbox", { name: "Note for Task note" })).toBeNull();
  });

  it("opens the resume dialog from an attention chip without opening the row menu", () => {
    state.boards.work = board([card("chip", { task: { id: "chip", text: "Task chip", done: false, startDate: "2026-10-18", createdAt: "", rank: "a" } })]);
    state.runs.chip = { handoff: "", latestRun: { runId: "run-chip", status: "done", startedAt: "", updatedAt: "", attention: { kind: "ci-failing", summary: "Typecheck failed", detectedAt: "", key: "ci" } } };
    render(<HomeWorkSummary />);
    fireEvent.click(screen.getByRole("button", { name: "CI failing — send the agent back to fix it" }));
    expect(screen.getByRole("dialog", { name: "Resume task agent" })).toBeInTheDocument();
  });
  it.each([false, true])("offers Ask a teammate and Hand off from the shared task menu only when linked=%s", (linked) => {
    state.teamLinked = linked;
    state.boards.work = board([card("team-row")]);
    render(<HomeWorkSummary />);
    fireEvent.contextMenu(screen.getByRole("article", { name: "Task team-row" }));
    expect(document.querySelector('[data-menu-item="team-ask"]') !== null).toBe(linked);
    expect(document.querySelector('[data-menu-item="team-handoff"]') !== null).toBe(linked);
  });
  it.each(["pending", "accepted", "pickup"] as const)("keeps My tasks read-only for %s ownership", (status) => {
    state.teamLinked = true;
    const current = card("handoff-row");
    current.task = { id: current.taskId, text: current.title, done: false, startDate: current.date, createdAt: current.updatedAt, rank: "a",
      ...(status === "pickup" ? { stage: "draft" as const, teamPickup: { handoffId: "h1", cwd: "/kept/worktree", branch: "feature/task", status: "pending" as const } } : { handoff: { handoffId: "h1", toUserId: "U2", toName: "helper", status, expiresAt: 1 } }),
    };
    state.boards.work = board([current]);
    render(<HomeWorkSummary />);
    const row = screen.getByRole("article", { name: "Task handoff-row" });
    expect(within(row).getByText(status === "pickup" ? "Confirming pickup…" : status === "pending" ? "Handing to @helper…" : "Handed to @helper")).toBeInTheDocument();
    expect(within(row).queryByRole("checkbox")).toBeNull();
    expect(within(row).queryByText("Draft")).toBeNull();
    expect(within(row).queryByRole("button", { name: /^(Complete|Close|Edit) / })).toBeNull();
    fireEvent.contextMenu(row);
    expect([...document.querySelectorAll("[data-menu-item]")].map((item) => item.getAttribute("data-menu-item"))).toEqual(["open"]);
  });
  it("keeps failure recovery one right-click away, scopes writes and offers Undo for Clear", async () => {
    state.boards.work = board([card("failed", { status: "in-progress", failure: { key: "failed-run", summary: "Agent timed out", cleared: false }, run: { runId: "r", status: "failed", startedAt: "" } })]);
    state.fetch.mockResolvedValue(Response.json({ ok: true }));
    render(<HomeWorkSummary />);
    const row = screen.getByRole("article", { name: "Task failed" });
    expect(within(row).getByText("Failed · Agent timed out")).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(state.fetch).toHaveBeenCalledOnce());
    expect(JSON.parse(state.fetch.mock.calls[0][1].body)).toMatchObject({ taskId: "failed", key: "failed-run", action: "retry" });
    fireEvent.contextMenu(row);
    fireEvent.click(document.querySelector('[data-menu-item="failure-guidance"]')!);
    expect(state.openTask).toHaveBeenLastCalledWith("failed", "guidance");
    fireEvent.contextMenu(row);
    fireEvent.click(document.querySelector('[data-menu-item="failure-logs"]')!);
    expect(state.openTask).toHaveBeenLastCalledWith("failed", "logs");
    fireEvent.contextMenu(row);
    fireEvent.click(document.querySelector('[data-menu-item="failure-clear"]')!);
    await waitFor(() => expect(state.success).toHaveBeenCalledWith("Failure cleared. Auto stays paused.", expect.anything()));
    await state.success.mock.calls.find(([message]) => message === "Failure cleared. Auto stays paused.")![1].action.onClick();
    expect(state.fetch.mock.calls.map(([, init]) => JSON.parse(init.body).action)).toEqual(["retry", "clear", "restore"]);
    expect(state.fetch.mock.calls.every(([url, init]) => url === "/api/tasks/failure" && init.headers["X-Devhub-Task-Profile"] === "work")).toBe(true);
  });

  it("keeps plan approval and revision on the row, with reported task cost", async () => {
    state.boards.work = board([card("plan", { costUsd: 1.23, auto: { status: "needs-you", phase: "plan", label: "Plan", round: 0, maxRounds: 2, planRunId: "plan-run", waiting: { kind: "plan-approval", reason: "Review the plan" } } })]);
    state.fetch.mockResolvedValue(Response.json({ ok: true }));
    render(<HomeWorkSummary />);
    const row = within(screen.getByRole("article", { name: "Task plan" }));
    expect(row.getByText("Plan ready")).toBeInTheDocument();
    expect(row.getByTitle("Reported task cost")).toHaveTextContent("1.23");
    fireEvent.click(row.getByRole("button", { name: "Revise" }));
    expect(state.openTask).toHaveBeenCalledWith("plan", "revise-plan");
    fireEvent.click(row.getByRole("button", { name: "Approve plan" }));
    await waitFor(() => expect(state.fetch).toHaveBeenCalledOnce());
    expect(JSON.parse(state.fetch.mock.calls[0][1].body)).toMatchObject({ action: "plan-decision", taskId: "plan", planRunId: "plan-run", decision: "approve" });
  });

  it.each(["OPEN", "MERGED"])("pins new feedback on finished tasks with the correct %s action", async (prState) => {
    const url = "https://github.com/acme/app/pull/1";
    state.boards.work = board([card("next"), card("finished", { status: "done", taskDone: true, prUrl: url, task: { id: "finished", text: "Task finished", done: true, startDate: "2026-10-18", rank: "a", createdAt: "", completedAt: "2026-10-18T10:00:00Z" } })]);
    state.prs.work!.feedbackPrs = [{ url, state: prState, self: "john", activity: [{ author: "reviewer", at: "2026-10-18T11:00:00Z", body: "Please fix this" }], failedChecks: [] }];
    state.fetch.mockResolvedValue(Response.json({ ok: true }));
    render(<HomeWorkSummary />);
    const row = within(screen.getByRole("article", { name: "Task finished" }));
    expect(row.getByText(/^New feedback ·/)).toBeInTheDocument();
    expect(screen.getByLabelText("1 tasks need action")).toBeInTheDocument();
    expect(screen.getAllByRole("article")[0]).toHaveAccessibleName("Task finished");
    if (prState === "OPEN") expect(row.getByRole("button", { name: "Reopen" })).toBeInTheDocument();
    fireEvent.click(row.getByRole("button", { name: prState === "MERGED" ? "Create follow-up task" : "Reopen and address feedback" }));
    await waitFor(() => expect(state.fetch).toHaveBeenCalledOnce());
    expect(state.fetch.mock.calls[0][0]).toBe("/api/tasks/reopen");
    expect(JSON.parse(state.fetch.mock.calls[0][1].body)).toMatchObject({ id: "finished", addressFeedback: prState === "OPEN", followUp: prState === "MERGED" });
  });

  it("reopens a finished task without starting an agent and keeps manual agent actions in its menu", async () => {
    state.boards.work = board([card("draft", { task: { id: "draft", text: "Task draft", done: false, startDate: "2026-10-18", createdAt: "", rank: "a", stage: "draft" } }), card("done", { taskDone: true })]);
    state.fetch.mockResolvedValue(Response.json({ ok: true }));
    render(<HomeWorkSummary />);
    fireEvent.contextMenu(screen.getByRole("article", { name: "Task draft" }));
    expect(document.querySelector('[data-menu-item="plan-agent"]')).toBeInTheDocument();
    expect(document.querySelector('[data-menu-item="start-auto"]')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Show all tasks" }));
    fireEvent.click(screen.getByRole("button", { name: "Finished" }));
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    await waitFor(() => expect(state.fetch).toHaveBeenCalledOnce());
    expect(state.fetch.mock.calls[0][0]).toBe("/api/tasks/reopen");
    expect(JSON.parse(state.fetch.mock.calls[0][1].body)).toMatchObject({ id: "done", addressFeedback: false, followUp: false });
  });

  it.each([false, true])("shows team card buttons and menu items only when linked=%s", (linked) => {
    state.teamLinked = linked;
    state.boards.work = board([card("team")]);
    render(<HomeWorkSummary />);
    fireEvent.contextMenu(screen.getByRole("article", { name: "Task team" }));
    expect(document.querySelector('[data-menu-item="team-ask"]') !== null).toBe(linked);
    expect(document.querySelector('[data-menu-item="team-handoff"]') !== null).toBe(linked);
    expect(screen.queryByRole("button", { name: "Ask a teammate…" }) !== null).toBe(linked);
    expect(screen.queryByRole("button", { name: "Hand off…" }) !== null).toBe(linked);
  });

  it("abandons through the shared menu and restores the same task identity with Undo", async () => {
    state.boards.work = board([card("abandon")]);
    render(<HomeWorkSummary />);
    fireEvent.click(within(section("My tasks")).getByRole("button", { name: "Actions for Task abandon" }));
    expect(document.querySelector('[data-menu-item="delete"]')).toBeNull();
    fireEvent.click(document.querySelector('[data-menu-item="abandon"]')!);
    await waitFor(() => expect(state.success).toHaveBeenCalledWith("Task closed.", expect.objectContaining({ duration: 7000 })));
    const undo = state.success.mock.calls.find(([message]) => message === "Task closed.")![1].action;
    await undo.onClick();
    expect(state.fetch.mock.calls.map(([, init]) => JSON.parse(init.body))).toEqual([
      { id: "abandon", status: "abandoned", date: "2026-10-18" },
      { id: "abandon", status: "active", date: "2026-10-18" },
    ]);
    expect(state.fetch.mock.calls.every(([, init]) => init.headers["X-Devhub-Task-Profile"] === "work")).toBe(true);
  });
  it.each(["My tasks"])("completes and closes from visible controls in %s with profile-scoped Undo", async (name) => {
    state.boards.work = board([card("controls")]);
    render(<HomeWorkSummary />);
    const region = within(section(name));
    fireEvent.click(region.getByRole("button", { name: "Complete Task controls" }));
    await waitFor(() => expect(state.success).toHaveBeenCalledWith("Task done.", expect.anything()));
    await state.success.mock.calls.find(([message]) => message === "Task done.")![1].action.onClick();
    fireEvent.click(region.getByRole("button", { name: "Close Task controls" }));
    await waitFor(() => expect(state.success).toHaveBeenCalledWith("Task closed.", expect.anything()));
    await state.success.mock.calls.find(([message]) => message === "Task closed.")![1].action.onClick();
    expect(state.fetch.mock.calls.map(([, init]) => JSON.parse(init.body))).toEqual([
      { id: "controls", completion: true, date: "2026-10-18" },
      { id: "controls", completion: false, date: "2026-10-18" },
      { id: "controls", status: "abandoned", date: "2026-10-18" },
      { id: "controls", status: "active", date: "2026-10-18" },
    ]);
    expect(state.fetch.mock.calls.every(([, init]) => init.headers["X-Devhub-Task-Profile"] === "work")).toBe(true);
  });

  it.each(["complete", "abandon"])("offers %s in a summary card's right-click menu", async (id) => {
    state.boards.work = board([card("menu")]);
    render(<HomeWorkSummary />);
    fireEvent.contextMenu(within(section("My tasks")).getByRole("article"));
    const item = document.querySelector(`[data-menu-item="${id}"]`)!;
    expect(item).toHaveTextContent(id === "complete" ? "Complete" : "Close");
    fireEvent.click(item);
    await waitFor(() => expect(state.fetch).toHaveBeenCalledOnce());
    expect(JSON.parse(state.fetch.mock.calls[0][1].body)).toMatchObject(id === "complete" ? { completion: true } : { status: "abandoned" });
  });

  it("guards running work: Complete stays disabled and Close asks once to stop the run", async () => {
    state.boards.work = board([card("live", { run: { runId: "r", status: "running", startedAt: "" } })]);
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    render(<HomeWorkSummary />);
    for (const name of ["My tasks"]) {
      const region = within(section(name));
      expect(region.getByRole("button", { name: "Complete Task live" })).toBeDisabled();
      fireEvent.click(region.getByRole("button", { name: "Close Task live" }));
    }
    expect(confirm).toHaveBeenCalledWith("Stop the run and close? Undo restores the task, not the run.");
    fireEvent.contextMenu(within(section("My tasks")).getByRole("article"));
    expect(document.querySelector('[data-menu-item="complete"]')).toBeDisabled();
    expect(state.fetch).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    state.fetch.mockImplementation(async () => Response.json({ ok: true }));
    fireEvent.click(document.querySelector('[data-menu-item="abandon"]')!);
    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(2));
    expect(state.fetch.mock.calls[0][0]).toBe("/api/storyboard/stop-work");
    expect(JSON.parse(state.fetch.mock.calls[0][1].body)).toEqual({ taskId: "live" });
    expect(JSON.parse(state.fetch.mock.calls[1][1].body)).toMatchObject({ status: "abandoned" });
  });

  it("reports failed Close and Undo without claiming success", async () => {
    state.boards.work = board([card("failure")]);
    render(<HomeWorkSummary />);
    const close = within(section("My tasks")).getByRole("button", { name: "Close Task failure" });
    state.fetch.mockResolvedValueOnce(Response.json({ error: "Cannot close" }, { status: 409 }));
    fireEvent.click(close);
    await waitFor(() => expect(state.error).toHaveBeenCalledWith("Cannot close"));
    expect(state.success).not.toHaveBeenCalled();
    fireEvent.click(close);
    await waitFor(() => expect(state.success).toHaveBeenCalledWith("Task closed.", expect.anything()));
    state.fetch.mockResolvedValueOnce(Response.json({ error: "Cannot restore" }, { status: 500 }));
    await state.success.mock.calls[0][1].action.onClick();
    expect(state.error).toHaveBeenCalledWith("Cannot restore");
  });
  it("shows deduplicated open tasks, expands in place and loads Finished only on request", () => {
    state.boards.work = board([card("old", { date: "2026-01-01" }), card("old"), card("two"), card("three"), card("four"), card("done", { taskDone: true })]);
    render(<HomeWorkSummary />);
    const tasks = within(section("My tasks"));
    expect(tasks.getAllByRole("article")).toHaveLength(3);
    expect(tasks.queryByText("Task four")).toBeNull();
    fireEvent.click(tasks.getByRole("button", { name: "Show all tasks" }));
    expect(tasks.getAllByRole("article")).toHaveLength(4);
    fireEvent.click(tasks.getByRole("button", { name: "Finished" }));
    expect(state.live).toHaveBeenCalledWith("/api/storyboard?done=all&taskProfile=work", expect.anything());
    expect(tasks.getByText("Task done")).toBeInTheDocument();
    expect(tasks.queryByText("Task old")).toBeNull();
  });

  it("keeps failed edits in place and sends profile and date with a retry", async () => {
    state.boards.work = board([card("edit")]);
    state.fetch.mockResolvedValueOnce(Response.json({ error: "Try again" }, { status: 500 }));
    render(<HomeWorkSummary />);
    const tasks = within(section("My tasks"));
    fireEvent.contextMenu(tasks.getByRole("article", { name: "Task edit" }));
    fireEvent.click(document.querySelector('[data-menu-item="edit"]')!);
    fireEvent.change(tasks.getByRole("textbox", { name: "Task title" }), { target: { value: "Revised title" } });
    fireEvent.click(tasks.getByRole("button", { name: "Save" }));
    expect(await tasks.findByRole("alert")).toHaveTextContent("Try again");
    expect(tasks.getByRole("textbox")).toHaveValue("Revised title");
    state.fetch.mockResolvedValueOnce(Response.json({ ok: true }));
    fireEvent.click(tasks.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(tasks.queryByRole("textbox")).toBeNull());
    expect(state.fetch).toHaveBeenLastCalledWith("/api/tasks", expect.objectContaining({ headers: expect.objectContaining({ "X-Devhub-Task-Profile": "work" }), body: JSON.stringify({ id: "edit", text: "Revised title", date: "2026-10-18" }) }));
  });
  it("hides cached task and own-PR work when the active profile cannot be confirmed", () => {
    state.boards.work = board([card("hidden")]);
    state.prs.work!.authored = [{ repo: "acme/app", number: 42, title: "My failing PR", url: "https://github.com/acme/app/pull/42", checks: "failing" }];
    state.profileError = new Error("Profile unavailable");
    render(<HomeWorkSummary />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't confirm the active profile");
    expect(screen.queryByText("My failing PR")).toBeNull();
    expect(screen.queryByText("Task hidden")).toBeNull();
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("uses content-shaped shimmer rather than the old boot overlay while the route loads", () => {
    const view = render(<HomeLoading />);
    expect(screen.getByLabelText("Loading page")).toHaveAttribute("aria-busy", "true");
    expect(view.container.querySelector(".skeleton")).toBeInTheDocument();
    expect(view.container.querySelector(".animate-spin")).toBeNull();
  });
  it("shows the date, freshness, capture and quiet context with briefing, note and calendar, without a Today toggle", () => {
    render(<HomeWorkSummary />);
    expect(screen.getByRole("heading", { level: 1, name: "What needs you" })).toBeInTheDocument();
    expect(screen.getByText("Sunday 18 October")).toBeInTheDocument();
    expect(screen.getByText("Updated just now")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Today →" })).toBeNull();
    expect(screen.getByRole("link", { name: "Briefing →" })).toHaveAttribute("href", "/briefing");
    expect(screen.getByRole("link", { name: "Today's note →" })).toHaveAttribute("href", "/notes/daily/2026-10-18");
    expect(screen.getByRole("link", { name: "No meetings today →" })).toHaveAttribute("href", "/calendar");
    expect(screen.queryByRole("grid")).toBeNull();
  });

  it("shows each task once, pins every attention row and keeps the count equal to the badge", () => {
    const questions = Array.from({ length: 5 }, (_, index) => card(`ask-${index}`, { counts: { openQuestions: 1, openBugs: 0, blockerBugs: 0, decisions: 0 } }));
    const running = card("run", { run: { runId: "r", status: "running", startedAt: "" } });
    const next = card("next");
    state.boards.work = board([next, running, ...questions, questions[0], next]);
    render(<HomeWorkSummary limit={3} />);
    const tasks = within(section("My tasks"));
    expect(screen.getAllByRole("article")).toHaveLength(5);
    expect(tasks.getByLabelText("5 tasks need action")).toHaveTextContent("5 need action");
    expect(document.querySelectorAll('[data-needs-action="true"]')).toHaveLength(5);
    for (const name of ["Next", "Running", "Needs action", "Review requested"]) expect(screen.queryByRole("region", { name })).toBeNull();
    fireEvent.click(tasks.getByRole("button", { name: "Show all tasks" }));
    expect(screen.getAllByRole("article")).toHaveLength(7);
    expect(screen.getAllByRole("link", { name: "Task next" })).toHaveLength(1);
    expect(tasks.getAllByRole("article")[0]).toHaveAccessibleName("Task ask-0");
    const expandedNames = tasks.getAllByRole("article").map((row) => row.getAttribute("aria-label"));
    expect(expandedNames.indexOf("Task run")).toBeLessThan(expandedNames.indexOf("Task next"));
    fireEvent.change(tasks.getByRole("searchbox"), { target: { value: "no match" } });
    expect(tasks.getAllByRole("article")).toHaveLength(5);
    fireEvent.click(tasks.getByRole("button", { name: "Finished" }));
    expect(tasks.getAllByRole("article")).toHaveLength(5);
  });

  it("puts running tasks above next in both the collapsed and expanded My tasks list", () => {
    const nextA = card("next-a", { rank: "a", title: "Task next-a" });
    const nextB = card("next-b", { rank: "b", title: "Task next-b" });
    const nextC = card("next-c", { rank: "c", title: "Task next-c" });
    const older = card("older-run", { status: "in-progress", title: "Task older-run", auto: { status: "running", phase: "implement", label: "Build", round: 0, maxRounds: 2, updatedAt: "2026-10-18T11:00:00Z" } });
    const newer = card("newer-run", { status: "in-progress", title: "Task newer-run", run: { runId: "r", status: "running", startedAt: "", updatedAt: "2026-10-18T11:50:00Z" } });
    state.boards.work = board([nextA, nextB, nextC, older, newer]);
    render(<HomeWorkSummary limit={3} />);
    const collapsed = within(section("My tasks")).getAllByRole("article").map((row) => row.getAttribute("aria-label"));
    expect(collapsed).toEqual(["Task newer-run", "Task older-run", "Task next-a"]);
    fireEvent.click(within(section("My tasks")).getByRole("button", { name: "Show all tasks" }));
    expect(within(section("My tasks")).getAllByRole("article").map((row) => row.getAttribute("aria-label")))
      .toEqual(["Task newer-run", "Task older-run", "Task next-a", "Task next-b", "Task next-c"]);
  });

  it("opens the same task detail at the next action and uses PR identity cards for peer review", () => {
    state.boards.work = board([card("ask", { counts: { openQuestions: 1, openBugs: 0, blockerBugs: 0, decisions: 0 } })]);
    const pr = { repo: "acme/app", number: 42, title: "Peer review", url: "https://github.com/acme/app/pull/42" };
    state.prs.work!.reviews = [pr, { ...pr, repo: "team/other", number: 99, title: "Team-wide request" }];
    render(<HomeWorkSummary />);
    expect(screen.queryByText("Team-wide request")).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "Answer" }));
    expect(state.openTask).toHaveBeenCalledWith("ask", "answer");
    expect(screen.queryByRole("article", { name: "Peer review" })).toBeNull();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it("shows a single quiet empty line, but only skeletons and unknown totals while loading", () => {
    const view = render(<HomeWorkSummary />);
    expect(screen.getAllByText("No open tasks.")).toHaveLength(1);
    state.profileLoading = true;
    view.rerender(<HomeWorkSummary />);
    expect(screen.queryByText("No open tasks.")).toBeNull();
    expect(screen.getByLabelText("Loading my tasks")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByLabelText("Task attention total unavailable")).toHaveTextContent("—");
    expect(view.container.querySelector(".skeleton")).not.toBeNull();
    expect(view.container.querySelector(".animate-spin")).toBeNull();
  });

  it("keeps last-known cards and marks the total unknown on a partial outage and retries only GitHub", () => {
    state.prs.work!.reviews = [{ repo: "acme/app", number: 42, title: "Last-known PR", url: "https://github.com/acme/app/pull/42" }];
    state.githubError = new Error("Timeout");
    render(<HomeWorkSummary />);
    expect(screen.queryByRole("article", { name: "Last-known PR" })).toBeNull();
    expect(screen.getByLabelText("0 tasks need action")).toHaveTextContent("0");
    expect(screen.getByText(/GitHub unavailable · last read/)).toBeInTheDocument();
    expect(screen.getByText("No open tasks.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(state.refreshPrs).toHaveBeenCalledOnce();
    expect(state.refreshBoard).not.toHaveBeenCalled();
    expect(state.refreshInbox).not.toHaveBeenCalled();
  });

  it("doesn't call an unknown source zero or briefly offer Start before workflow decisions load", () => {
    state.boards.work = board([card("unknown")]);
    state.inboxes.work = undefined; state.inboxError = new Error("Offline");
    state.prs.work = undefined; state.githubError = new Error("Offline");
    render(<HomeWorkSummary />);
    expect(screen.queryByText("No open tasks.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Start on auto" })).toBeNull();
    expect(screen.getByLabelText("Task attention total unavailable")).toHaveTextContent("—");
    expect(screen.getByText("GitHub unavailable. Review totals are unavailable.")).toBeInTheDocument();
  });

  it("re-scopes every work read and capture destination immediately after switching profile", async () => {
    state.boards.work = board([card("same-id", { title: "Work-only task" })]);
    state.boards.home = board([card("same-id", { title: "Home-only task" })]);
    const view = render(<HomeWorkSummary />);
    expect(within(section("My tasks")).getByText("Work-only task")).toBeInTheDocument();
    state.active = "home";
    view.rerender(<HomeWorkSummary />);
    expect(screen.queryByText("Work-only task")).toBeNull();
    expect(within(section("My tasks")).getByText("Home-only task")).toBeInTheDocument();
    expect(screen.getByText("Saves to home · To do · doesn't start an agent")).toBeInTheDocument();
    for (const endpoint of ["/api/storyboard", "/api/tasks/workflow", "/api/github/prs"]) expect(state.live).toHaveBeenCalledWith(`${endpoint}?taskProfile=home`, expect.objectContaining({ keepPreviousData: false }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "A home idea" } });
    fireEvent.submit(screen.getByRole("form", { name: "Capture an idea" }));
    await waitFor(() => expect(state.success).toHaveBeenCalled());
    expect(state.fetch).toHaveBeenCalledExactlyOnceWith("/api/tasks/capture", expect.objectContaining({ body: JSON.stringify({ text: "A home idea", profile: "home" }) }));
    expect(state.fetch.mock.calls.every(([url]) => url === "/api/tasks/capture")).toBe(true);
  });

  it("captures a Jira key and #tag from Home as one draft in the active profile, with the Tasks composer's link tools", async () => {
    render(<HomeWorkSummary />);
    expect(screen.getByRole("button", { name: "Associate repo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add task" })).toBeNull();
    const input = screen.getByRole("textbox", { name: "Capture an idea or paste a ticket" });
    expect(input).toHaveAccessibleDescription("Saves to work · To do · doesn't start an agent");
    fireEvent.change(input, { target: { value: "PROJ-12 fix login #auth" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(state.success).toHaveBeenCalledWith("Saved to work · To do. No agent started."));
    expect(within(section("My tasks")).getByRole("searchbox", { name: "Search my tasks" })).toHaveValue("");
    expect(within(section("My tasks")).getByRole("button", { name: "All open" })).toHaveAttribute("aria-pressed", "true");
    expect(state.fetch).toHaveBeenCalledExactlyOnceWith("/api/tasks/capture", expect.objectContaining({
      headers: expect.objectContaining({ "X-Devhub-Task-Profile": "work" }),
      body: JSON.stringify({ text: "PROJ-12 fix login #auth", links: [{ kind: "jira", id: "PROJ-12", label: "PROJ-12" }], profile: "work" }),
    }));
  });

  it("normalises Today bookmarks without mounting the old dashboard", () => {
    state.query = "view=today";
    render(<HomePage />);
    expect(state.replace).toHaveBeenCalledWith("/", { scroll: false });
    expect(screen.getByRole("heading", { name: "What needs you" })).toBeInTheDocument();
  });

  it("only starts automation after the explicit Start action", async () => {
    state.boards.work = board([card("start")]);
    state.fetch.mockResolvedValue(Response.json({ ok: true }));
    render(<HomeWorkSummary />);
    expect(state.fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Owned" }));
    expect(state.fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Start on auto" }));
    await waitFor(() => expect(state.fetch).toHaveBeenCalledOnce());
    expect(state.fetch.mock.calls[0][0]).toBe("/api/storyboard/orchestrate");
    expect(JSON.parse(state.fetch.mock.calls[0][1].body)).toMatchObject({ taskId: "start", pauseAfterPlan: true });
  });

  it("keeps one next action alongside the quiet lifecycle controls on each card", () => {
    state.boards.work = board([card("idle")]);
    render(<HomeWorkSummary />);
    const task = within(screen.getByRole("article", { name: "Task idle" }));
    expect(task.getByRole("button", { name: "Complete Task idle" })).toBeInTheDocument();
    expect(task.getByRole("button", { name: "Close Task idle" })).toBeInTheDocument();
    expect(task.getAllByRole("button").filter((button) => button.textContent !== "Add note" && !["Auto options", "Complete Task idle", "Close Task idle", "Actions for Task idle"].includes(button.getAttribute("aria-label") ?? ""))).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Mark Task idle done" })).toBeNull();
  });

  it("shows AI review notes once on the task row and refreshes all work sources", async () => {
    state.boards.work = board([card("ready", { status: "ready-for-review" }), card("review", { review: { gist: "Fix the timeout test", notes: "Fix the timeout test", runId: "review" } })]);
    render(<HomeWorkSummary />);
    expect(within(section("My tasks")).getByText("Review ready · Fix the timeout test")).toBeInTheDocument();
    expect(screen.getByLabelText("2 tasks need action")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Task ready" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("link", { name: "Open review" }));
    expect(state.openTask).toHaveBeenCalledWith("review", "evidence");
    fireEvent.click(screen.getByRole("button", { name: "Updated just now" }));
    expect(screen.getByRole("button", { name: "Refreshing…" })).toBeDisabled();
    await waitFor(() => expect(state.refreshBoard).toHaveBeenCalledOnce());
    expect(state.refreshInbox).toHaveBeenCalledOnce();
    expect(state.refreshPrs).toHaveBeenCalledOnce();
  });
});

 it("expands work inline, collapses without losing focus and resets when the profile changes", () => {
    state.boards.work = board(Array.from({ length: 5 }, (_, index) => card(`next-${index}`)));
    state.boards.home = board(Array.from({ length: 4 }, (_, index) => card(`home-${index}`)));
    const view = render(<HomeWorkSummary />);
    const region = within(section("My tasks"));
    expect(region.getAllByRole("article")).toHaveLength(3);
    const toggle = region.getByRole("button", { name: "Show all tasks" });
    toggle.focus(); fireEvent.click(toggle);
    expect(region.getAllByRole("article")).toHaveLength(5);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveFocus();
    fireEvent.click(toggle);
    expect(region.getAllByRole("article")).toHaveLength(3);
    expect(toggle).toHaveFocus();
    fireEvent.click(toggle);
    state.active = "home"; view.rerender(<HomeWorkSummary />);
    expect(within(section("My tasks")).getAllByRole("article")).toHaveLength(3);
    expect(within(section("My tasks")).getByRole("button", { name: "Show all tasks" })).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps review without notes and finishing work visible in My tasks", () => {
    state.boards.work = board([card("review", { status: "ready-for-review" }), card("merged", { prState: "merged" })]);
    render(<HomeWorkSummary />);
    expect(within(section("My tasks")).getAllByRole("article")).toHaveLength(2);
    expect(screen.queryByRole("region", { name: "Review requested" })).toBeNull();
  });
