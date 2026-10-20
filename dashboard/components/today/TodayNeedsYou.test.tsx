/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TodayNeedsYou } from "./TodayNeedsYou";
import type { BoardCard, NotesBoard } from "@/lib/storyboard/notes-board-shared";
import type { WorkflowInboxResponse } from "@/lib/workflows/inbox";

const state = vi.hoisted(() => ({
  board: undefined as NotesBoard | undefined,
  inbox: undefined as WorkflowInboxResponse | undefined,
  boardError: undefined as Error | undefined,
  inboxError: undefined as Error | undefined,
  openTask: vi.fn(), detailEnabled: false,
  refresh: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn(), fetch: vi.fn(),
}));
vi.mock("@/lib/hooks/use-fetch", () => ({ useLive: (key: string) => ({
  data: key === "/api/storyboard" ? state.board : state.inbox,
  error: key === "/api/storyboard" ? state.boardError : state.inboxError,
  mutate: state.refresh,
}) }));
vi.mock("swr", () => ({ mutate: vi.fn() }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ success: state.success, error: state.error, info: state.info }) }));
vi.mock("@/components/storyboard/TaskDetailProvider", () => ({ useTaskDetail: () => state.detailEnabled ? { openTask: state.openTask, hrefForTask: (taskId: string) => `/?task=${taskId}` } : null }));

function card(taskId: string, patch: Partial<BoardCard> = {}): BoardCard {
  return {
    taskId, title: `Task ${taskId}`, status: "todo", taskDone: false, date: "2026-10-17",
    notePath: `task-notes/${taskId}`, noteHref: `/notes/task-notes/${taskId}`, repo: "app", jira: ["APP-42"],
    tags: [], links: [], models: [], summary: [], counts: { openQuestions: 0, openBugs: 0, blockerBugs: 0, decisions: 0 },
    screenshot: null, images: [], jev: null, tiers: null, run: null, steps: [], updatedAt: new Date().toISOString(), attention: null, ...patch,
  };
}
function board(cards: BoardCard[]): NotesBoard { return { cards, columns: [], generatedAt: new Date().toISOString(), errors: [], hiddenDone: 0 }; }
beforeEach(() => {
  vi.clearAllMocks();
  state.board = board([]);
  state.inbox = { items: [] };
  state.boardError = undefined;
  state.inboxError = undefined;
  state.detailEnabled = false;
  state.fetch.mockImplementation(async () => Response.json({}));
  vi.stubGlobal("fetch", state.fetch);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Today's attention preview", () => {
  it("caps unique tasks, counts the whole attention set, and links to the cross-status filter", () => {
    const question = card("question", { counts: { openQuestions: 2, openBugs: 0, blockerBugs: 0, decisions: 0 } });
    state.board = board([question, question, card("review", { status: "ready-for-review" }), card("merged", { prState: "merged" }), card("fourth", { status: "needs-you", counts: { openQuestions: 1, openBugs: 0, blockerBugs: 0, decisions: 0 } }), card("ordinary")]);
    render(<TodayNeedsYou />);
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.getByRole("heading", { name: "Needs you4" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "View all →" })).toHaveAttribute("href", "/storyboard?attention=needs-you");
    expect(screen.queryByText("Task ordinary")).toBeNull();
    expect(within(screen.getByRole("article", { name: "Task question" })).getByRole("link", { name: "Answer" })).toHaveAttribute("href", "/notes/task-notes/question#task-note-questions");
    expect(screen.getByText("2 questions need answers")).toBeTruthy();
  });

  it("includes publication decisions outside the Needs you column even when their update was read", () => {
    const proposal = card("proposal");
    state.board = board([proposal]);
    state.inbox = { items: [{ task: { id: proposal.taskId } as WorkflowInboxResponse["items"][number]["task"], workflow: {
      version: 1, taskId: proposal.taskId, stage: "draft-pr", status: "waiting-user", revision: 2, seenRevision: 2, checks: [], reviews: [], events: [],
      proposals: [{ id: "pr", kind: "draft-pr", runId: "run", fingerprint: "a", contentHash: "b", destination: "acme/app", content: "A PR", expiresAt: "2027-01-01", state: "pending" }],
    } }] };
    render(<TodayNeedsYou />);
    expect(screen.getByRole("link", { name: "Review proposal" })).toHaveAttribute("href", "/workflow?taskId=proposal");
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it("has a quiet empty state, and skeletons rather than an empty state or spinner while loading", () => {
    const view = render(<TodayNeedsYou />);
    expect(screen.getByText("Nothing waiting for you")).toBeTruthy();
    state.board = undefined;
    view.rerender(<TodayNeedsYou />);
    expect(screen.getByLabelText("Loading tasks needing you")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("Nothing waiting for you")).toBeNull();
    expect(view.container.querySelector(".skeleton")).toBeTruthy();
    expect(view.container.querySelector(".animate-spin")).toBeNull();
  });

  it("keeps last-known cards on an outage and doesn't call an incomplete queue empty", () => {
    state.board = board([card("last-known", { prState: "merged" })]);
    state.inboxError = new Error("offline");
    render(<TodayNeedsYou />);
    expect(screen.getByRole("button", { name: "Finish" })).toBeTruthy();
    expect(screen.getByText(/list may be incomplete/)).toBeTruthy();
    expect(screen.queryByText("Nothing waiting for you")).toBeNull();
  });

  it.each(["Retry", "One more round"])("disables pending %s and sends only one request for two rapid clicks", async (label) => {
    const waiting = label === "Retry" ? "failure" : "cap";
    state.board = board([card("retry", { status: "needs-you", auto: { status: "needs-you", phase: "fix", label: "Fix", round: 2, maxRounds: 2, waiting: { kind: waiting, reason: label === "Retry" ? "Build failed" : "2 fix rounds used; 1 blocker remains" } } })]);
    let respond!: (response: Response) => void;
    state.fetch.mockImplementation(() => new Promise<Response>((resolve) => { respond = resolve; }));
    render(<TodayNeedsYou />);
    const button = screen.getByRole("button", { name: label });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(state.fetch).toHaveBeenCalledOnce());
    expect(button).toBeDisabled();
    expect(JSON.parse(state.fetch.mock.calls[0][1].body)).toMatchObject({ action: "retry", taskId: "retry" });
    await act(async () => { respond(Response.json({})); });
    await waitFor(() => expect(button).toBeEnabled());
  });

  it("finishes through the tasks API once, with explicit Undo and no Jira/PR write", async () => {
    state.board = board([card("finish", { prState: "merged" })]);
    let respond!: (response: Response) => void;
    state.fetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { respond = resolve; }));
    render(<TodayNeedsYou />);
    const button = screen.getByRole("button", { name: "Finish" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(state.fetch).toHaveBeenCalledOnce());
    expect(button).toBeDisabled();
    expect(state.fetch.mock.calls[0][0]).toBe("/api/tasks");
    expect(JSON.parse(state.fetch.mock.calls[0][1].body)).toEqual({ id: "finish", completion: true, date: "2026-10-17" });
    await act(async () => { respond(Response.json({ done: true })); });
    const options = state.success.mock.calls.find(([message]) => message === "Task done.")?.[1];
    expect(options.action.label).toBe("Undo");
    await act(async () => { await options.action.onClick(); });
    expect(JSON.parse(state.fetch.mock.calls[1][1].body)).toEqual({ id: "finish", completion: false, date: "2026-10-17" });
    expect(state.fetch.mock.calls.every(([url]) => url === "/api/tasks")).toBe(true);
  });

  it("opens the shared task detail from the title without navigating away", () => {
    state.board = board([card("note", { prState: "merged" })]);
    state.detailEnabled = true;
    render(<TodayNeedsYou />);
    const title = screen.getByRole("link", { name: "Task note" });
    expect(title).toHaveAttribute("href", "/?task=note");
    fireEvent.click(title);
    expect(state.openTask).toHaveBeenCalledExactlyOnceWith("note");
    expect(state.fetch).not.toHaveBeenCalled();
  });
});
