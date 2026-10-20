/** @vitest-environment jsdom */
import { cleanup, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardCard, NotesBoard } from "@/lib/storyboard/notes-board-shared";
import type { Task } from "@/lib/tasks/types";
import type { WorkflowInboxItem } from "@/lib/workflows/inbox";
import type { GithubPrsApiPayload } from "@/lib/github/prs";
import type { JiraTicket } from "@/lib/jira/client";
import { TASK_NOTE_STATUSES, TASK_NOTE_STATUS_LABEL } from "@shared/task-note/meta.ts";
import { readTaskNote } from "@shared/task-note/sections.ts";

const ui = vi.hoisted(() => ({ reviewNotesError: undefined as Error | undefined, query: "", active: "work", prs: { configured: true, authored: [], reviews: [], recentlyReviewed: [] } as GithubPrsApiPayload, jira: { configured: true, tickets: [] } as { configured: boolean; tickets: JiraTicket[] } | undefined, replace: vi.fn(), mutate: vi.fn(async (): Promise<NotesBoard | undefined> => undefined), board: null as unknown, items: [] as WorkflowInboxItem[], toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: ui.replace }),
  usePathname: () => "/storyboard",
  useSearchParams: () => new URLSearchParams(useSyncExternalStore((notify) => {
    const onPop = () => { ui.query = window.location.search.slice(1); notify(); };
    window.addEventListener("popstate", onPop);
    window.addEventListener("task-test-url", notify);
    return () => { window.removeEventListener("popstate", onPop); window.removeEventListener("task-test-url", notify); };
  }, () => ui.query)),
}));
vi.mock("@/lib/hooks/use-fetch", () => ({ defaultFetcher: vi.fn(), useLive: (key: string | null) => ({
  data: key === "/api/storyboard" || key?.startsWith("/api/storyboard?") ? ui.board
    : key === "/api/tasks/profiles" ? { active: ui.active }
    : key === "/api/own" ? { repos: [{ fullName: "acme/app" }] }
    : key === "/api/jira/tickets" ? ui.jira
    : key === "/api/storyboard/orchestrate" ? { orchestrations: [], errors: [] }
    : key === "/api/tasks/workflow" || key?.startsWith("/api/tasks/workflow?taskProfile=") ? { items: ui.items }
    : key?.startsWith("/api/github/prs") ? ui.prs
    : key?.startsWith("/api/tasks/note/sections") ? { view: readTaskNote([]) }
    : undefined,
  error: key === "/api/storyboard/pr-review-notes" ? ui.reviewNotesError : undefined, mutate: ui.mutate,
}) }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ui.toast }));
vi.mock("./ModelTierPicker", () => ({ ModelTierPicker: () => <div aria-label="Model tiers"><select aria-label="Cheap agent" /></div> }));
vi.mock("./OrchestratorStatus", () => ({ OrchestratorStatus: () => <span>Auto · idle</span> }));
vi.mock("@/components/tasks/useTaskAgentActions", () => ({ useTaskAgentActions: () => ({ menuItems: [], dialogs: null }) }));
// The shared Today's-tasks menu has its own tests; here it stands in with its "Open note" item plus the board's groups.
vi.mock("@/components/tasks/useTaskMenu", () => ({
  useTaskMenu: ({ task, handlers, extraGroups = [] }: { task: { notePath?: string }; handlers: { onOpenNote?: (notePath: string) => void }; extraGroups?: unknown[] }) => ({
    groups: [{ id: "task", items: [{ id: "note", label: "Open note", onSelect: () => handlers.onOpenNote?.(task.notePath ?? "") }] }, ...extraGroups],
    dialogs: null, agent: { chip: null, upstart: null },
  }),
}));
vi.mock("@/components/vault/VaultEditorPage", () => ({ VaultEditorPage: ({ path, embedded }: { path: string[]; embedded?: boolean }) => <div data-testid="note-editor" data-embedded={String(!!embedded)}>{path.join("/")}</div> }));
vi.mock("@/app/tickets/client", () => ({ default: ({ query }: { query: string }) => <section aria-label="Jira work view">{query}</section> }));
vi.mock("@/app/tasks/client", () => ({ default: ({ query }: { query: string }) => <section aria-label="History work view">{query}</section> }));

import StoryboardClient from "./client";

function card(taskId: string, patch: Partial<BoardCard> = {}): BoardCard {
  return {
    taskId, title: `Task ${taskId}`, status: "todo", taskDone: false, date: "2026-10-10",
    notePath: `task-notes/2026-10-10-${taskId}`, noteHref: `/notes/task-notes/2026-10-10-${taskId}`,
    tags: [], links: [], models: [], summary: [], counts: { openQuestions: 0, openBugs: 0, blockerBugs: 0, decisions: 0 },
    screenshot: null, images: [], jev: null, tiers: null, run: null, steps: [], updatedAt: "2026-10-17T10:00:00.000Z", attention: null, ...patch,
  };
}

function board(cards: BoardCard[], extra: Partial<NotesBoard> = {}): NotesBoard {
  return {
    columns: TASK_NOTE_STATUSES.map((status) => ({ status, label: TASK_NOTE_STATUS_LABEL[status], count: cards.filter((item) => item.status === status).length })),
    cards, generatedAt: "2026-10-17T12:00:00.000Z", hiddenDone: 0, errors: [], ...extra,
  };
}

const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  ui.query = "";
  ui.reviewNotesError = undefined;
  ui.active = "work";
  ui.prs = { configured: true, authored: [], reviews: [], recentlyReviewed: [] };
  ui.jira = { configured: true, tickets: [] };
  ui.items = [];
  window.history.replaceState(null, "", "/storyboard");
  const push = window.history.pushState.bind(window.history);
  const replace = window.history.replaceState.bind(window.history);
  vi.spyOn(window.history, "pushState").mockImplementation((data, unused, url) => { push(data, unused, url); ui.query = window.location.search.slice(1); window.dispatchEvent(new Event("task-test-url")); });
  vi.spyOn(window.history, "replaceState").mockImplementation((data, unused, url) => { replace(data, unused, url); ui.query = window.location.search.slice(1); window.dispatchEvent(new Event("task-test-url")); });
  fetchMock.mockResolvedValue(Response.json({}));
  vi.stubGlobal("fetch", fetchMock);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Storyboard notes board", () => {
  it("keeps the page controls mounted while shared task rows load, then reveals the board", () => {
    ui.board = undefined;
    const view = render(<StoryboardClient />);
    const heading = screen.getByRole("heading", { name: "Storyboard" });
    const search = screen.getByPlaceholderText("Search title, tag, repo or summary");
    const loading = screen.getByRole("status", { name: "Loading board" });
    expect(loading).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("region", { name: "To do" })).toBeNull();
    expect(screen.queryByText("No tasks yet")).toBeNull();

    ui.board = board([card("loaded")]);
    view.rerender(<StoryboardClient />);
    expect(screen.queryByLabelText("Loading board")).toBeNull();
    expect(screen.getByRole("article", { name: "Task loaded" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Storyboard" })).toBe(heading);
    expect(screen.getByPlaceholderText("Search title, tag, repo or summary")).toBe(search);
  });

  it("explains unavailable review notes and offers a retry without hiding task cards", () => {
    ui.board = board([card("a")]);
    ui.reviewNotesError = new Error("Review notes unavailable");
    render(<StoryboardClient />);
    const error = screen.getByText("Couldn’t refresh PR reviews. The review column may be incomplete.").parentElement!;
    expect(screen.getByRole("article", { name: "Task a" })).toBeInTheDocument();
    fireEvent.click(within(error).getByRole("button", { name: /retry/i }));
    expect(ui.mutate).toHaveBeenCalledTimes(2);
  });

  it("opens Home's Running filter without paused, manual, blocked or Needs you work", () => {
    ui.query = "queue=running&profile=work";
    ui.board = board([
      card("running", { run: { runId: "live", status: "running", startedAt: "2026-10-17T11:55:00Z" } }),
      card("question", { counts: { openQuestions: 1, openBugs: 0, blockerBugs: 0, decisions: 0 }, run: { runId: "ask", status: "running", startedAt: "2026-10-17T11:55:00Z" } }),
      card("manual", { auto: { status: "paused-manual", phase: "implement", label: "Build", round: 0, maxRounds: 2 } }),
      card("paused", { run: { runId: "paused", status: "paused", startedAt: "" } }),
      card("blocked", { status: "blocked", run: { runId: "blocked", status: "running", startedAt: "2026-10-17T11:55:00Z" } }),
    ]);
    render(<StoryboardClient />);
    expect(screen.getByRole("link", { name: "Task running" })).toBeInTheDocument();
    for (const hidden of ["Task question", "Task manual", "Task paused", "Task blocked"]) expect(screen.queryByRole("link", { name: hidden })).toBeNull();
    expect(screen.getByRole("link", { name: "View progress" })).toBeInTheDocument();
  });

  it("opens Home's Next filter in existing rank order and keeps manual Done", () => {
    ui.query = "queue=next&profile=work";
    ui.board = board([
      card("later", { task: { id: "later", text: "Task later", startDate: "2026-10-17", rank: "a2", done: false, createdAt: "" } }),
      card("manual", { rank: "a1", auto: { status: "paused-manual", phase: "implement", label: "Build", round: 0, maxRounds: 2 } }),
      card("finished", { prState: "merged" }),
    ]);
    render(<StoryboardClient />);
    expect(screen.getByRole("link", { name: "Task manual" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Task later" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(screen.queryByText("Task finished")).toBeNull();
  });

  it("includes peer review PR identities in Home's Needs you filter and count", () => {
    ui.query = "attention=needs-you&profile=work";
    ui.board = board([card("question", { counts: { openQuestions: 1, openBugs: 0, blockerBugs: 0, decisions: 0 } }), card("next")]);
    const pr = { repo: "acme/app", number: 42, title: "Peer change", url: "https://github.com/acme/app/pull/42" };
    ui.prs.reviews = [pr, pr, { ...pr, repo: "team/other", number: 99, title: "Team-wide request" }];
    render(<StoryboardClient />);
    expect(screen.getByRole("button", { name: "Needs you (2)" })).toBeInTheDocument();
    const peer = within(screen.getByRole("region", { name: "Pull requests needing you" }));
    expect(peer.getAllByRole("article")).toHaveLength(1);
    expect(peer.getByText("acme/app · PR #42")).toBeInTheDocument();
    expect(peer.getByRole("link", { name: "Review" })).toHaveAttribute("href", expect.stringContaining("pr=acme%2Fapp%2342"));
    expect(screen.queryByText("Task next")).toBeNull();
    expect(screen.queryByText("Team-wide request")).toBeNull();
  });

  it("doesn't reinterpret a saved Home filter in another active profile", () => {
    ui.query = "queue=next&profile=work";
    ui.active = "home";
    ui.board = board([card("same-id", { title: "Personal task" })]);
    render(<StoryboardClient />);
    expect(screen.getByRole("alert")).toHaveTextContent("This view belongs to work, but the active profile is home");
    expect(screen.queryByText("Personal task")).toBeNull();
    expect(screen.getByRole("button", { name: "Show active profile" })).toBeInTheDocument();
  });

  it("keeps unread informational Updates and unresolved Needs you counts independent", async () => {
    ui.board = board([card("proposal")]);
    ui.items = [{ task: { id: "proposal", text: "Task proposal", done: false, startDate: "2026-10-17", createdAt: "", rank: "a1" }, workflow: {
      version: 1, taskId: "proposal", revision: 1, seenRevision: 0, status: "waiting-user", stage: "draft-pr", checks: [], reviews: [],
      proposals: [{ id: "p", runId: "r", kind: "draft-pr", state: "pending", fingerprint: "abc", destination: "acme/app", content: "PR", contentHash: "hash", expiresAt: "2026-10-19T00:00:00Z" }],
      events: [{ id: "e", at: "2026-10-17T12:00:00Z", summary: "Review accepted" }],
    } }];
    const view = render(<StoryboardClient />);
    expect(screen.getByRole("button", { name: "Blocked (0)" })).toBeInTheDocument();
    expect(screen.getByLabelText("1 unread updates")).toBeInTheDocument();
    ui.query = "inbox=1&attention=needs-you";
    view.rerender(<StoryboardClient />);
    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tasks/workflow", expect.objectContaining({ body: JSON.stringify({ taskId: "proposal", revision: 1, action: "seen" }) })));
    ui.items = ui.items.map((item) => ({ ...item, workflow: { ...item.workflow, seenRevision: 1 } }));
    view.rerender(<StoryboardClient />);
    expect(screen.queryByLabelText("1 unread updates")).toBeNull();
    expect(screen.getByRole("button", { name: "Blocked (0)" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review proposal" })).toBeInTheDocument();
  });

  it("filters Needs you across columns, including review-ready and merged open tasks", () => {
    ui.query = "attention=needs-you";
    ui.board = board([
      card("question", { counts: { openQuestions: 2, openBugs: 0, blockerBugs: 0, decisions: 0 } }),
      card("review", { status: "ready-for-review" }),
      card("finish", { prState: "merged" }),
      card("ordinary"),
    ]);
    render(<StoryboardClient />);
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.queryByText("Task ordinary")).toBeNull();
    expect(screen.getByRole("link", { name: "Review" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Finish" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(ui.replace).toHaveBeenLastCalledWith("/storyboard", { scroll: false });
  });

  it("finishes a merged card once through task completion, not a note move, and offers Undo", async () => {
    ui.board = board([card("finish", { prState: "merged" })]);
    let respond!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { respond = resolve; }));
    render(<StoryboardClient />);
    const button = screen.getByRole("button", { name: "Finish" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(button).toBeDisabled();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/tasks");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ id: "finish", completion: true, date: "2026-10-10" });
    respond(Response.json({ done: true }));
    await waitFor(() => expect(ui.toast.success).toHaveBeenCalledWith("Task done.", expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) })));
  });

  it("explains why a merged card with live work cannot finish", () => {
    ui.board = board([card("live", { prState: "merged", run: { runId: "run-live", status: "running", startedAt: new Date().toISOString() } })]);
    render(<StoryboardClient />);
    expect(screen.queryByRole("button", { name: "Finish" })).toBeNull();
    expect(screen.getByRole("link", { name: "View progress" })).toBeTruthy();
    expect(screen.getByText(/stop it before finishing/)).toBeTruthy();
  });

  it("shows a column per status, collapsing empty ones to a strip you can expand", () => {
    ui.board = board([card("a", { status: "in-progress" })]);
    render(<StoryboardClient />);
    expect(screen.getAllByRole("region").map((region) => region.getAttribute("aria-label"))).toEqual(TASK_NOTE_STATUSES.map((status) => status === "needs-you" ? "Waiting for you" : TASK_NOTE_STATUS_LABEL[status]));
    expect(screen.getByRole("button", { name: /In progress/ })).toHaveAttribute("aria-expanded", "true");
    const todo = screen.getByRole("button", { name: /To do/ });
    expect(todo).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(todo);
    expect(todo).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Nothing here.")).toBeTruthy();
  });

  it("opens the note from the title and has no status dropdown on the card face", () => {
    ui.board = board([card("a", { status: "in-progress" })]);
    render(<StoryboardClient />);
    expect(screen.getByRole("link", { name: "Task a" })).toHaveAttribute("href", "/storyboard?taskProfile=work&task=a");
    expect(screen.queryByRole("combobox", { name: "Task status" })).toBeNull();
  });

  describe("drag and drop", () => {
    const transfer = () => ({ setData: vi.fn(), getData: vi.fn(), effectAllowed: "", dropEffect: "" });
    const region = (name: string) => screen.getByRole("region", { name });

    it("drops a card on a collapsed empty column, highlights it, writes the note status and moves the card", async () => {
      ui.board = board([card("a")]);
      render(<StoryboardClient />);
      const article = document.getElementById("card-a")!;
      expect(article).toHaveAttribute("draggable", "true");
      expect(region("Blocked")).toHaveAttribute("data-collapsed", "true");
      fireEvent.dragStart(article, { dataTransfer: transfer() });
      expect(article).toHaveAttribute("data-dragging", "true");
      fireEvent.dragOver(region("Blocked"), { dataTransfer: transfer() });
      expect(region("Blocked")).toHaveAttribute("data-drop", "ok");
      // Hovering opens the collapsed column.
      await waitFor(() => expect(region("Blocked")).not.toHaveAttribute("data-collapsed"));
      fireEvent.drop(region("Blocked"), { dataTransfer: transfer() });
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/api/storyboard/move");
      expect(JSON.parse(String(init.body))).toEqual({ taskId: "a", status: "blocked" });
      const optimistic = (ui.mutate.mock.calls[0] as unknown[])[0] as (current: NotesBoard) => NotesBoard;
      expect(optimistic(ui.board as NotesBoard).cards[0].status).toBe("blocked");
      await waitFor(() => expect(ui.toast.success).toHaveBeenCalledWith("Moved to Blocked."));
      expect(region("Blocked")).not.toHaveAttribute("data-drop");
    });

    it("rolls the card back and says why when the write fails", async () => {
      ui.board = board([card("a")]);
      fetchMock.mockResolvedValue(Response.json({ error: "Note is locked" }, { status: 409 }));
      render(<StoryboardClient />);
      fireEvent.dragStart(document.getElementById("card-a")!, { dataTransfer: transfer() });
      fireEvent.dragOver(region("Planning"), { dataTransfer: transfer() });
      fireEvent.drop(region("Planning"), { dataTransfer: transfer() });
      await waitFor(() => expect(ui.toast.error).toHaveBeenCalledWith("Note is locked"));
      expect(ui.mutate).toHaveBeenCalledWith(ui.board, { revalidate: false });
    });

    it("lets a To do drop override old agent work and immediately clear stale attention", async () => {
      ui.board = board([card("a", { status: "in-progress", autoStatus: "in-progress", run: { runId: "old", status: "failed", startedAt: "" } })]);
      render(<StoryboardClient />);
      fireEvent.dragStart(document.getElementById("card-a")!, { dataTransfer: transfer() });
      fireEvent.dragOver(region("To do"), { dataTransfer: transfer() });
      expect(region("To do")).toHaveAttribute("data-drop", "ok");
      fireEvent.drop(region("To do"), { dataTransfer: transfer() });
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toMatchObject({ taskId: "a", status: "todo" });
      const optimistic = (ui.mutate.mock.calls[0] as unknown[])[0] as (current: NotesBoard) => NotesBoard;
      expect(optimistic(ui.board as NotesBoard).cards[0]).toMatchObject({ status: "todo", statusSetAt: expect.any(String), attention: null });
      await waitFor(() => expect(ui.toast.success).toHaveBeenCalledWith("Moved to To do."));
    });

    it("keeps the To do target available while hovering a card with a derived status", () => {
      ui.board = board([card("a", { status: "in-progress", autoStatus: "in-progress" }), card("b")]);
      render(<StoryboardClient />);
      fireEvent.dragStart(document.getElementById("card-a")!, { dataTransfer: transfer() });
      expect(within(region("To do")).queryByText(/can’t go back to To do/)).toBeNull();
      fireEvent.dragOver(region("To do"), { dataTransfer: transfer() });
      expect(region("To do")).toHaveAttribute("data-drop", "ok");
      fireEvent.dragEnd(document.getElementById("card-a")!);
      expect(within(region("To do")).queryByText(/can’t go back to To do/)).toBeNull();
    });

    it("does not let a task ticked done in Tasks be dragged", () => {
      ui.board = board([card("a", { status: "done", taskDone: true })]);
      render(<StoryboardClient />);
      // Done starts collapsed.
      expect(document.getElementById("card-a")).toBeNull();
      fireEvent.click(within(screen.getByRole("region", { name: "Done" })).getAllByRole("button")[0]);
      expect(document.getElementById("card-a")).toHaveAttribute("draggable", "false");
    });

    it("moves a focused card one column with Alt+Right and Alt+Left, keeping keyboard access", async () => {
      ui.board = board([card("a", { status: "planning" })]);
      render(<StoryboardClient />);
      const article = document.getElementById("card-a")!;
      expect(article).toHaveAttribute("tabindex", "0");
      expect(article).toHaveAttribute("aria-keyshortcuts", "Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown Shift+F10");
      article.focus();
      fireEvent.keyDown(article, { key: "ArrowRight", altKey: true });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toMatchObject({ status: "in-progress" });
      fireEvent.keyDown(article, { key: "ArrowLeft", altKey: true });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body))).toMatchObject({ status: "todo" });
      // Keys from a link inside the card are left alone.
      fireEvent.keyDown(screen.getByRole("link", { name: "Task a" }), { key: "ArrowRight", altKey: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("moves a card up or down its column with Alt+Up/Down, writing only its rank", async () => {
      ui.board = board([card("a", { rank: "c" }), card("b", { rank: "m" }), card("c", { rank: "t" })]);
      render(<StoryboardClient />);
      fireEvent.keyDown(document.getElementById("card-c")!, { key: "ArrowUp", altKey: true });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
      expect(body).toMatchObject({ notePath: "task-notes/2026-10-10-c", op: "set_rank" });
      expect(body.rank > "c" && body.rank < "m").toBe(true);
      const optimistic = (ui.mutate.mock.calls[0] as unknown[])[0] as (current: NotesBoard) => NotesBoard;
      expect(optimistic(ui.board as NotesBoard).cards.map((item) => item.taskId)).toEqual(["a", "c", "b"]);
      // Already at the top: nothing to write.
      fireEvent.keyDown(document.getElementById("card-a")!, { key: "ArrowUp", altKey: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // A successful reorder is silent: no success toast, and never "That didn’t work" or a revert.
      await waitFor(() => expect(ui.mutate).toHaveBeenCalledWith());
      expect(ui.toast.success).not.toHaveBeenCalled();
      expect(ui.toast.error).not.toHaveBeenCalled();
      expect(ui.mutate).not.toHaveBeenCalledWith(ui.board, { revalidate: false });
    });

    it("reorders by dragging within the column, showing where the card will land", async () => {
      ui.board = board([card("a", { rank: "c" }), card("b", { rank: "m" }), card("c")]);
      render(<StoryboardClient />);
      const column = region("To do");
      const rects: Record<string, number> = { "card-a": 0, "card-b": 100, "card-c": 200 };
      for (const article of column.querySelectorAll<HTMLElement>("article")) {
        article.getBoundingClientRect = () => ({ top: rects[article.id], height: 80, bottom: rects[article.id] + 80, left: 0, right: 100, width: 100, x: 0, y: rects[article.id], toJSON: () => ({}) });
      }
      fireEvent.dragStart(document.getElementById("card-a")!, { dataTransfer: transfer() });
      // Below b's middle, above c's: lands between b and the never-ranked c.
      // jsdom's DragEvent drops clientY from the init dict, so set it on the event.
      const at = (event: Event) => Object.defineProperty(event, "clientY", { value: 170 });
      const over = createEvent.dragOver(column, { dataTransfer: transfer() });
      fireEvent(column, at(over));
      expect(column).toHaveAttribute("data-reordering", "true");
      expect(column.querySelectorAll("[class*='dropLine']")).toHaveLength(1);
      fireEvent(column, at(createEvent.drop(column, { dataTransfer: transfer() })));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
      expect(body).toMatchObject({ notePath: "task-notes/2026-10-10-a", op: "set_rank" });
      expect(body.rank > "m").toBe(true);
      expect(column).not.toHaveAttribute("data-reordering");
    });

    it("opens the column a card is moved into, so a column the user collapsed doesn't swallow the card and its focus", async () => {
      ui.board = board([card("a", { status: "planning" }), card("b", { status: "in-progress" })]);
      render(<StoryboardClient />);
      const target = screen.getByRole("button", { name: /In progress/ });
      fireEvent.click(target);
      expect(target).toHaveAttribute("aria-expanded", "false");
      fireEvent.keyDown(document.getElementById("card-a")!, { key: "ArrowRight", altKey: true });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(target).toHaveAttribute("aria-expanded", "true");
    });
  });

  it("offers Create note on a task-only card and scaffolds it by task and day", async () => {
    ui.board = board([card("b", { notePath: null, noteHref: null })]);
    render(<StoryboardClient />);
    expect(screen.getByRole("link", { name: "Task b" })).toHaveAttribute("href", "/storyboard?taskProfile=work&task=b");
    fireEvent.click(screen.getByRole("button", { name: /Create note/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({ taskId: "b", date: "2026-10-10", op: "set_meta" });
  });

  it("gives a To do card one primary action, Start on auto on the saved tiers, with Create note under Details", async () => {
    ui.board = board([card("t", { notePath: null, noteHref: null }), card("p", { status: "planning" })]);
    render(<StoryboardClient />);
    const todo = document.getElementById("card-t")!;
    const primary = within(todo).getAllByRole("button").filter((button) => button.className.includes("btn-primary"));
    expect(primary.map((button) => button.textContent)).toEqual(["Start on auto"]);
    // Quiet (outline) until the card is hovered or focused; still the one primary, one click.
    expect(primary[0].className).toContain("startAuto");
    expect(within(todo).getByRole("button", { name: /Create note/ }).closest("details")).not.toBeNull();
    expect(within(document.getElementById("card-p")!).queryByRole("button", { name: /Start on auto/ })).toBeNull();
    fireEvent.click(within(todo).getByRole("button", { name: /Start on auto/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/storyboard/orchestrate");
    // No tiers in the body: the route starts on the saved defaults.
    expect(JSON.parse(String(init.body))).toEqual({ action: "start", taskId: "t", taskDate: "2026-10-10", pauseAfterPlan: true, idempotencyKey: expect.stringMatching(/^[a-f0-9]{32}$/) });
    await waitFor(() => expect(window.location.search).toBe("?taskProfile=work&task=t"));
    expect(ui.toast.success).toHaveBeenCalledWith("On auto.");
  });

  it.each(["planning", "needs-you"] as const)("reveals a started card in a collapsed %s column and focuses its detail", async (status) => {
    ui.board = board([card("t"), card("p", { status })]);
    render(<StoryboardClient />);
    const column = screen.getByRole("region", { name: status === "needs-you" ? "Waiting for you" : TASK_NOTE_STATUS_LABEL[status] });
    fireEvent.click(within(column).getAllByRole("button")[0]);
    expect(column).toHaveAttribute("data-collapsed", "true");
    ui.mutate.mockImplementationOnce(async () => {
      const updated = board([card("t", { status }), card("p", { status })]);
      ui.board = updated;
      return updated;
    });
    const start = screen.getByRole("button", { name: "Start on auto" });
    start.focus();
    fireEvent.click(start);
    await waitFor(() => expect(column).not.toHaveAttribute("data-collapsed"));
    const detail = await screen.findByRole("dialog", { name: "Task: Task t" });
    await waitFor(() => expect(detail.contains(document.activeElement)).toBe(true));
  });

  it("shows a failed Start as an error and focuses its recovery state", async () => {
    ui.board = board([card("t")]);
    fetchMock.mockResolvedValue(Response.json({ dispatchError: "Paseo is unavailable.", runId: null }, { status: 201 }));
    render(<StoryboardClient />);
    fireEvent.click(screen.getByRole("button", { name: "Start on auto" }));
    await waitFor(() => expect(ui.toast.error).toHaveBeenCalledWith("Paseo is unavailable."));
    expect(ui.toast.success).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?taskProfile=work&task=t");
  });

  it("lets the board use the full content width instead of the centred page max", () => {
    const css = fs.readFileSync(path.join(__dirname, "storyboard.module.css"), "utf8");
    expect(css).toMatch(/\.page:global\(\.page-wrapper\)\s*\{[^}]*max-width:\s*none/);
    expect(css).toMatch(/\.column\s*\{[^}]*flex:\s*1(?:\s|;)/);
    expect(css).toMatch(/\.column\s*\{[^}]*min-width:\s*272px/);
    expect(css).toMatch(/\.column\[data-collapsed\]\s*\{[^}]*min-width:\s*40px/);
  });

  it("keeps Start on auto quiet (outline) until its card is hovered, focused or selected", () => {
    const css = fs.readFileSync(path.join(__dirname, "storyboard.module.css"), "utf8");
    const rule = css.match(/\.card:not\(:hover\):not\(:focus-within\):not\(\[data-focused\]\) \.startAuto:not\(:disabled\) \{([^}]*)\}/);
    expect(rule?.[1]).toMatch(/background: transparent/);
    expect(rule?.[1]).toMatch(/border-color: var\(--accent\)/);
    // Only on hover-capable screens: touch keeps the full primary button.
    expect(css.slice(0, rule!.index)).toMatch(/@media \(hover: hover\) \{\s*$/);
  });

  it("gives stuck cards a one-click button: Answer opens the note's questions, Retry restarts, Clear abandons", async () => {
    ui.board = board([
      card("ask", { status: "needs-you", attention: { reason: "awaiting", label: "Waiting on you", action: { kind: "open", label: "Answer", href: "/notes/task-notes/2026-10-10-ask#task-note-questions" } } }),
      card("fail", { status: "in-progress", attention: { reason: "failing", label: "Run failed", action: { kind: "retry", label: "Retry", taskId: "fail" } } }),
      card("idle", { status: "in-progress", attention: { reason: "idle", label: "Agent idle", action: { kind: "clear", label: "Clear", taskId: "idle", runId: "run-1" } } }),
    ]);
    render(<StoryboardClient />);
    expect(screen.getByRole("link", { name: "Answer" })).toHaveAttribute("href", "/storyboard?taskProfile=work&task=ask");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [retryUrl, retryInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(retryUrl).toBe("/api/tasks/agent-runs/resume");
    expect(JSON.parse(String(retryInit.body))).toMatchObject({ taskId: "fail", date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [clearUrl, clearInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(clearUrl).toBe("/api/tasks/agent-runs");
    expect(JSON.parse(String(clearInit.body))).toEqual({ taskId: "idle", runId: "run-1", status: "abandoned" });
  });

  it("shows the Jev review, tier line, counts and screenshot on a card", () => {
    ui.board = board([card("a", {
      status: "in-progress",
      counts: { openQuestions: 1, openBugs: 2, blockerBugs: 0, decisions: 3 },
      screenshot: { url: "/api/qa/runs/r/media/a.png", source: "jev" },
      jev: { runId: "r", title: "t", status: "failed", capturedAt: "2026-10-17T10:00:00Z", bugCount: 2, goalsPassed: 1, goalsTotal: 2, receiptHref: "/qa?run=r&task=a", beforeVideo: "/b.webm", afterVideo: "/a.webm", screenshot: null },
      tiers: [{ step: "plan", tier: "mid", label: "Mid · default", active: false }, { step: "implement", tier: "mid", label: "Mid · default", active: true }, { step: "verify", tier: "cheap", label: "Cheap · default", active: false }],
    })]);
    render(<StoryboardClient />);
    expect(screen.getByRole("button", { name: "View screenshot for Task a" }).querySelector("img")).toBeNull();
    expect(screen.getByText("3 decisions")).toBeTruthy();
    expect(screen.getByText("2 open bugs")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Receipt" })).toHaveAttribute("href", "/qa?run=r&task=a");
    expect(screen.getByRole("link", { name: /Before/ })).toHaveAttribute("href", "/b.webm");
    expect(screen.getByRole("link", { name: /After/ })).toHaveAttribute("href", "/a.webm");
    const tierLine = screen.getAllByLabelText("Model tiers").find((element) => element.querySelector("b"))!;
    expect(tierLine.textContent).toMatch(/Plan mid\s*Implement mid\s*Verify cheap/);
    expect(within(tierLine).getByText("mid", { selector: "b" })).toBeTruthy();
  });

  it("opens every image in an in-app viewer, newest first, and browses them with the arrow keys", () => {
    const images = [
      { url: "/m/c.png", caption: "Newest", source: "note" as const },
      { url: "/m/b.png", source: "note" as const, name: "middle.png" },
      { url: "/m/a.png", caption: "Oldest", source: "note" as const },
    ];
    ui.board = board([card("a", { screenshot: { url: "/m/c.png", source: "note", caption: "Newest" }, images }), card("b", { screenshot: { url: "/m/x.png", source: "note" }, images: [{ url: "/m/x.png", source: "note" }] })]);
    render(<StoryboardClient />);
    // Only a card with more than one image gets the count badge.
    const thumb = screen.getByRole("button", { name: "View 3 images for Task a" });
    expect(thumb.textContent).toBe("3");
    expect(screen.getByRole("button", { name: "View screenshot for Task b" }).textContent).toBe("");
    thumb.focus();
    fireEvent.click(thumb);
    const dialog = screen.getByRole("dialog", { name: "Images for Task a" });
    expect(within(dialog).getByRole("img")).toHaveAttribute("src", "/m/c.png");
    expect(within(dialog).getByText("1 / 3")).toBeTruthy();
    expect(within(dialog).getByText("Newest")).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Close viewer" }));
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(within(dialog).getByText("2 / 3")).toBeTruthy();
    expect(within(dialog).getByText("middle.png")).toBeTruthy();
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect(within(dialog).getByText("3 / 3")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Next image" }));
    expect(within(dialog).getByText("1 / 3")).toBeTruthy();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(thumb);
  });

  it("keeps cards compact and only loads screenshots when the viewer opens", () => {
    ui.board = board([card("a", { screenshot: { url: "/m/latest.png", source: "note" }, images: [{ url: "/m/latest.png", source: "note" }] })]);
    render(<StoryboardClient />);
    expect(document.querySelector("article img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View screenshot for Task a" }));
    expect(within(screen.getByRole("dialog", { name: "Images for Task a" })).getByRole("img")).toHaveAttribute("src", "/m/latest.png");
  });

  it("closes the image viewer on a click outside the image", () => {
    ui.board = board([card("a", { screenshot: { url: "/m/a.png", source: "note" }, images: [{ url: "/m/a.png", source: "note" }] })]);
    render(<StoryboardClient />);
    fireEvent.click(screen.getByRole("button", { name: "View screenshot for Task a" }));
    const dialog = screen.getByRole("dialog");
    // One image: no counter, no arrows.
    expect(within(dialog).queryByText(/\d+ \/ \d+/)).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Next image" })).toBeNull();
    fireEvent.click(dialog.parentElement!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("logs each agent run with its tier, model and approximate cost", () => {
    ui.board = board([card("a", {
      status: "in-progress",
      steps: [
        { runId: "r2", role: "review", status: "done", tier: "heavy", provider: "claude", model: "opus", costUsd: 0.4234 },
        { runId: "r1", role: "implement", status: "failed", tier: "mid", provider: "codex", tokens: 12_400 },
        { runId: "r0", role: "plan", status: "done", provider: "claude" },
      ],
    })]);
    render(<StoryboardClient />);
    const log = screen.getByRole("list", { name: "Agent runs" });
    expect(Array.from(log.querySelectorAll("li"), (item) => item.textContent)).toEqual(["Reviewheavyopus≈$0.42", "Implementmidcodex12k tok", "Planclaude"]);
  });

  it("filters by search text", () => {
    ui.board = board([card("a", { title: "Fix login" }), card("b", { title: "Ship board" })]);
    render(<StoryboardClient />);
    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: "login" } });
    expect(screen.getByText("Fix login")).toBeTruthy();
    expect(screen.queryByText("Ship board")).toBeNull();
  });

  it("opens Board settings at the tier picker for ?settings=model-tiers", () => {
    ui.query = "settings=model-tiers";
    ui.board = board([card("a")]);
    const { container } = render(<StoryboardClient />);
    expect(container.querySelector("details")).toHaveProperty("open", true);
  });

  it("highlights and scrolls to ?task=<id>, and says so when that task is not on the board", () => {
    ui.query = "task=a";
    ui.board = board([card("a")]);
    const { unmount } = render(<StoryboardClient />);
    expect(document.getElementById("card-a")).toHaveAttribute("data-focused", "true");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    unmount();
    ui.query = "task=gone";
    render(<StoryboardClient />);
    expect(screen.getByText(/That task isn’t on the board/)).toBeTruthy();
  });

  it("asks for older done work through the URL", () => {
    ui.board = board([card("a")], { hiddenDone: 4 });
    render(<StoryboardClient />);
    fireEvent.click(screen.getByLabelText("Show older done cards"));
    expect(ui.replace).toHaveBeenCalledWith("/storyboard?done=all", { scroll: false });
  });

  it("keeps the card face to title, one progress line and one action, with the rest in collapsed Details", () => {
    ui.board = board([card("a", {
      status: "draft-pr",
      tags: ["ui"],
      summary: ["Sidebar no longer overlaps"],
      steps: [{ runId: "r1", role: "review", status: "running", tier: "mid", model: "sonnet", label: "Review" }],
      auto: { phase: "verify", label: "Review + Jev", round: 0, maxRounds: 2, ui: { value: true, detected: true, reason: "changes app/sidebar.tsx" }, noPreview: "The task has no preview URL." },
    })]);
    render(<StoryboardClient />);
    const article = document.getElementById("card-a")!;
    expect(within(article).getByText("Auto · Reviewing (4/5) · no preview")).toBeTruthy();
    const details = article.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(within(details).getByRole("list", { name: "Agent runs" })).toBeTruthy();
    expect(within(details).getByText("Sidebar no longer overlaps")).toBeTruthy();
    expect(within(details).getByText(/No preview, so no videos/)).toBeTruthy();
    expect(within(article).queryAllByRole("button").filter((button) => !details.contains(button) && button.textContent !== "Add note")).toEqual([]);
  });

  it("shows Manual on the card after auto mode is switched off", () => {
    ui.board = board([card("a", { status: "in-progress", auto: { status: "paused-manual", phase: "implement", label: "Implement", round: 0, maxRounds: 2 } })]);
    render(<StoryboardClient />);
    expect(within(document.getElementById("card-a")!).getByText("Manual · Building (2/5)")).toBeTruthy();
  });

  it("marks a card as a UI change from its details, and goes back to detection", async () => {
    ui.board = board([card("a", { auto: { phase: "implement", label: "Implement", round: 0, maxRounds: 2, ui: { value: false, detected: false, reason: "changes lib/api.ts only" } } })]);
    render(<StoryboardClient />);
    expect(screen.getByText("Detected: changes lib/api.ts only")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /Changes the UI/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/storyboard/orchestrate", expect.objectContaining({ body: expect.stringContaining('"ui":true') })));
  });

  it("filters by tag or repo from one Show menu, kept in the URL", () => {
    ui.board = board([card("a", { title: "Fix login", tags: ["auth"] }), card("b", { title: "Ship board", repo: "devhub" })]);
    const view = render(<StoryboardClient />);
    fireEvent.change(screen.getByRole("combobox", { name: "Show" }), { target: { value: "repo:devhub" } });
    expect(ui.replace).toHaveBeenLastCalledWith("/storyboard?repo=devhub", { scroll: false });
    ui.query = "repo=devhub";
    view.rerender(<StoryboardClient />);
    expect(screen.queryByText("Fix login")).toBeNull();
    expect(screen.getByText("Ship board")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Show" }), { target: { value: "tag:auth" } });
    expect(ui.replace).toHaveBeenLastCalledWith("/storyboard?tag=auth", { scroll: false });
    ui.query = "tag=auth";
    view.rerender(<StoryboardClient />);
    expect(screen.getByText("Fix login")).toBeTruthy();
    expect(screen.queryByText("Ship board")).toBeNull();
  });

  it("filters by Jira ticket, parent epic or No Jira from the URL, with one Clear filters", () => {
    ui.board = board([
      card("a", { title: "Child one", jira: ["PTF-5001"], parentJira: "PTF-4891" }),
      card("b", { title: "Epic itself", jira: ["PTF-4891"] }),
      card("c", { title: "Other ticket", jira: ["DAD-7"] }),
      card("d", { title: "Side project", repo: "vowbreak" }),
    ]);
    ui.query = "parentJira=PTF-4891";
    const view = render(<StoryboardClient />);
    const jira = screen.getByRole("combobox", { name: "Jira" }) as HTMLSelectElement;
    expect(jira.value).toBe("parent:PTF-4891");
    expect([...jira.options].map((option) => option.textContent)).toEqual(["Any ticket", "No Jira", "PTF-4891 and children", "DAD-7", "PTF-4891", "PTF-5001"]);
    expect(screen.getByText("Child one")).toBeTruthy();
    expect(screen.getByText("Epic itself")).toBeTruthy();
    expect(screen.queryByText("Other ticket")).toBeNull();
    fireEvent.change(jira, { target: { value: "none" } });
    expect(ui.replace).toHaveBeenLastCalledWith("/storyboard?jira=none", { scroll: false });
    ui.query = "jira=none&repo=vowbreak&done=all";
    view.rerender(<StoryboardClient />);
    expect(screen.getByText("Side project")).toBeTruthy();
    expect(screen.queryByText("Child one")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    // Clears every filter and keeps unrelated params.
    expect(ui.replace).toHaveBeenLastCalledWith("/storyboard?done=all", { scroll: false });
  });

  describe("card menu and task detail", () => {
    const withTask = (taskId: string, patch: Partial<BoardCard> = {}) =>
      card(taskId, { task: { id: taskId, text: `Task ${taskId}`, done: false, notePath: `task-notes/2026-10-10-${taskId}` } as unknown as Task, ...patch });

    it("allows Move to To do after an old run", async () => {
      ui.board = board([withTask("a", { status: "draft-pr", autoStatus: "draft-pr", run: { runId: "old", status: "done", startedAt: "" } })]);
      render(<StoryboardClient />);
      fireEvent.contextMenu(document.getElementById("card-a")!, { clientX: 40, clientY: 40 });
      const menu = await screen.findByRole("menu", { hidden: true });
      fireEvent.click(within(menu).getByRole("menuitem", { name: "Move to…", hidden: true }));
      const todo = within(menu).getByRole("menuitem", { name: /To do/, hidden: true });
      expect(todo).toBeEnabled();
      fireEvent.click(todo);
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toMatchObject({ taskId: "a", status: "todo" });
    });

    // The menu is a manual popover, which jsdom treats as hidden.
    it("opens the card menu on right-click with Retry, Move up/down and Move to", async () => {
      ui.board = board([
        withTask("a", { status: "in-progress", attention: { reason: "failing", label: "Run failed", action: { kind: "retry", label: "Retry", taskId: "a" } } }),
        withTask("b", { status: "in-progress" }),
      ]);
      render(<StoryboardClient />);
      fireEvent.contextMenu(screen.getByRole("link", { name: "Task a" }).closest("article")!, { clientX: 40, clientY: 40 });
      const menu = await screen.findByRole("menu", { hidden: true });
      expect(within(menu).getByRole("menuitem", { name: /Move up/, hidden: true })).toBeDisabled();
      expect(within(menu).getByRole("menuitem", { name: /Move down/, hidden: true })).toBeEnabled();
      expect(within(menu).queryByRole("menuitem", { name: /^To do$/, hidden: true })).toBeNull();
      fireEvent.click(within(menu).getByRole("menuitem", { name: "Move to…", hidden: true }));
      expect(within(menu).getByRole("menuitem", { name: /^To do$/, hidden: true })).toBeTruthy();
      expect(within(menu).queryByRole("menuitem", { name: /^In progress/, hidden: true })).toBeNull();
      fireEvent.keyDown(document, { key: "Escape" });

      fireEvent.click(within(menu).getByRole("menuitem", { name: /Retry/, hidden: true }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tasks/agent-runs/resume", expect.anything()));
      expect(screen.getByRole("link", { name: "Task a" }).closest("article")).not.toHaveAttribute("data-context-menu", "open");
    });

    it("opens the same task menu from the visible card action button", async () => {
      ui.board = board([withTask("a", { status: "ready-for-review" })]);
      render(<StoryboardClient />);
      fireEvent.click(screen.getByRole("button", { name: "Actions for Task a" }));
      const menu = within(await screen.findByRole("menu", { hidden: true }));
      expect(menu.getByRole("menuitem", { name: /^Copy Slack message/, hidden: true })).toBeInTheDocument();
      expect(menu.getByRole("menuitem", { name: /^Reset to To do/, hidden: true })).toBeInTheDocument();
      expect(menu.getByRole("menuitem", { name: "Move to…", hidden: true })).toBeInTheDocument();
    });

    it("puts the task title before its decision and keeps approval beside revision", () => {
      ui.board = board([withTask("plan", { status: "needs-you", auto: { status: "needs-you", phase: "plan", label: "Plan", round: 0, maxRounds: 2, planRunId: "plan-run", waiting: { kind: "plan-approval", reason: "Review the plan" } } })]);
      render(<StoryboardClient />);
      const row = within(screen.getByRole("article", { name: "Task plan" }));
      const title = row.getByRole("link", { name: "Task plan" });
      const status = row.getByRole("status");
      expect(title.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(row.getByRole("button", { name: "Approve plan" }).parentElement).toBe(row.getByRole("button", { name: "Revise" }).parentElement);
    });

    it("opens the card menu from the keyboard with Shift+F10", async () => {
      ui.board = board([withTask("a", { status: "in-progress" })]);
      render(<StoryboardClient />);
      const article = screen.getByRole("link", { name: "Task a" }).closest("article")!;
      fireEvent.keyDown(article, { key: "F10", shiftKey: true });
      expect(await screen.findByRole("menu", { hidden: true })).toBeTruthy();
    });

    it("opens task detail from the title, retaining its embedded note and closing on Esc or outside", async () => {
      ui.board = board([withTask("a", { status: "in-progress" })]);
      render(<StoryboardClient />);
      fireEvent.click(screen.getByRole("link", { name: "Task a" }));
      const detail = await screen.findByRole("dialog", { name: "Task: Task a" });
      fireEvent.click(within(detail).getByText("Open note", { selector: "summary" }));
      expect(await screen.findByTestId("note-editor")).toHaveTextContent("task-notes/2026-10-10-a");
      expect(screen.getByTestId("note-editor")).toHaveAttribute("data-embedded", "true");
      expect(screen.getByRole("link", { name: /Open in Notes/ })).toHaveAttribute("href", "/notes/task-notes/2026-10-10-a");

      fireEvent.keyDown(document, { key: "Escape" });
      await waitFor(() => expect(screen.queryByTestId("note-editor")).toBeNull());
      expect(ui.mutate).toHaveBeenCalled();

      fireEvent.click(screen.getByRole("link", { name: "Task a" }));
      fireEvent.click(await screen.findByTestId("task-detail-backdrop"));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("keeps Cmd-click on the title as a normal link", () => {
      ui.board = board([withTask("a", { status: "in-progress" })]);
      render(<StoryboardClient />);
      fireEvent.click(screen.getByRole("link", { name: "Task a" }), { metaKey: true });
      expect(screen.queryByTestId("note-editor")).toBeNull();
    });

    it("uses the same detail with its note expanded for the menu's Open note", async () => {
      ui.board = board([withTask("a", { status: "in-progress" })]);
      render(<StoryboardClient />);
      fireEvent.contextMenu(screen.getByRole("link", { name: "Task a" }).closest("article")!, { clientX: 40, clientY: 40 });
      fireEvent.click(within(await screen.findByRole("menu", { hidden: true })).getByRole("menuitem", { name: /Open note/, hidden: true }));
      expect(await screen.findByTestId("note-editor")).toHaveTextContent("task-notes/2026-10-10-a");
    });
  });
});

it("omits missing summaries from legacy board cards", () => {
  ui.board = board([card("legacy", { summary: [] })]);
  render(<StoryboardClient />);
  expect(within(document.getElementById("card-legacy")!).queryByText("No summary yet")).toBeNull();
});
