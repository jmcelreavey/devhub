/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkCard } from "./WorkCard";
import { useTaskCompletion } from "./useTaskCompletion";
import { resolveNextAction } from "@/lib/storyboard/next-action";
import { runTaskAction, useTaskActionPending } from "@/lib/storyboard/task-action";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";

const state = vi.hoisted(() => ({ fetch: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn(), openBrowser: vi.fn() }));
vi.mock("swr", () => ({ mutate: vi.fn() }));
vi.mock("@/lib/hooks/use-fetch", () => ({ useLive: () => ({ data: { linked: false, members: [] } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/hooks/use-tag-menu", () => ({ useTagMenuGroup: () => ({ group: null, modal: null }), withTagsGroup: (groups: unknown) => groups }));
vi.mock("@/lib/desktop/bridge", () => ({ openInBrowser: state.openBrowser }));
vi.mock("@/components/tasks/useTaskMenu", () => ({ useTaskMenu: ({ extraGroups }: { extraGroups: unknown[] }) => ({ groups: extraGroups, dialogs: null }) }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ success: state.success, error: state.error, info: state.info }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

const manual: BoardCard = {
  taskId: "manual", date: "2026-10-17", title: "Check the release", repo: "app", jira: ["APP-42"],
  status: "in-progress", taskDone: false, notePath: "task-notes/manual", noteHref: "/notes/task-notes/manual",
  tags: [], links: [], models: [], summary: [], counts: { openQuestions: 0, openBugs: 0, blockerBugs: 0, decisions: 0 },
  auto: { status: "paused-manual", phase: "implement", label: "Build", round: 0, maxRounds: 2 },
  screenshot: null, images: [], jev: null, tiers: null, run: null, steps: [], updatedAt: "2026-10-17T12:00:00Z", attention: null,
};
const now = Date.parse(manual.updatedAt);

function ManualCard() {
  const complete = useTaskCompletion();
  const pending = useTaskActionPending(manual.taskId);
  return <WorkCard card={manual} presentation={resolveNextAction(manual, undefined, now)} pending={pending} onAction={() => void complete(manual)} />;
}

describe("shared WorkCard", () => {
  it("offers both feedback work and plain reopen without opening the task", () => {
    const onAction = vi.fn();
    const finished = { ...manual, taskDone: true, status: "done" as const };
    render(<WorkCard card={finished} presentation={{ status: "New feedback on a finished task", needsYou: true, action: { kind: "reopen-feedback", label: "Reopen and address feedback" } }} onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(onAction).toHaveBeenLastCalledWith({ kind: "reopen", label: "Reopen" });
    fireEvent.click(screen.getByRole("button", { name: "Reopen and address feedback" }));
    expect(onAction).toHaveBeenLastCalledWith({ kind: "reopen-feedback", label: "Reopen and address feedback" });
  });
  it("offers plain Reopen in the shared context menu of finished cards without a PR", () => {
    const finished = { ...manual, taskDone: true, status: "done" as const };
    render(<WorkCard card={finished} presentation={{ status: "Done", needsYou: false, action: null }} onAction={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole("article"));
    expect(screen.getByText("Reopen")).toBeTruthy();
    expect(screen.queryByText("Reopen and address feedback")).toBeNull();
  });
  it("offers follow-up rather than reopen when the PR is merged", () => {
    const finished = { ...manual, taskDone: true, status: "done" as const, prUrl: "https://github.com/acme/app/pull/1", prState: "merged" as const };
    render(<WorkCard card={finished} presentation={{ status: "Done", needsYou: false, action: null }} onAction={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole("article"));
    expect(screen.getByText("Create follow-up task")).toBeTruthy();
    expect(screen.queryByText("Reopen")).toBeNull();
  });
  it("shows title, repo/Jira context, one status and one action", () => {
    render(<WorkCard card={manual} presentation={resolveNextAction(manual, undefined, now)} onAction={vi.fn()} />);
    expect(screen.getByRole("link", { name: manual.title })).toHaveAttribute("href", manual.noteHref);
    expect(screen.getByText("app · APP-42")).toBeTruthy();
    expect(screen.getByText(/Manual/)).toBeTruthy();
    // Add note sits beside the one action; it is not a second status action.
    expect(screen.getAllByRole("button").filter((button) => button.textContent !== "Add note")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
  });

  it("disables Done while pending and two rapid clicks produce one explicit completion request", async () => {
    let respond!: (response: Response) => void;
    state.fetch.mockImplementation(() => new Promise<Response>((resolve) => { respond = resolve; }));
    vi.stubGlobal("fetch", state.fetch);
    render(<ManualCard />);
    const button = screen.getByRole("button", { name: "Done" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(state.fetch).toHaveBeenCalledOnce());
    expect(button).toBeDisabled();
    expect(JSON.parse(state.fetch.mock.calls[0][1].body)).toMatchObject({ id: manual.taskId, completion: true });
    await act(async () => { respond(Response.json({})); });
    await waitFor(() => expect(button).toBeEnabled());
  });

  it("refuses stale Finish callbacks when live work appears, explaining instead of hiding the run", async () => {
    const { result } = renderHook(() => useTaskCompletion());
    vi.stubGlobal("fetch", state.fetch);
    await act(async () => {
      const response = await result.current({ ...manual, run: { runId: "live", status: "running", startedAt: "" } });
      expect(response.ok).toBe(false);
    });
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.info).toHaveBeenCalledWith(expect.stringContaining("stop it before finishing"));
  });

  it("never shares pending actions for the same task ID across profiles", async () => {
    let finishWork!: (result: { ok: boolean }) => void;
    const work = vi.fn(() => new Promise<{ ok: boolean }>((resolve) => { finishWork = resolve; }));
    const home = vi.fn(async () => ({ ok: true }));
    const { result } = renderHook(() => ({ work: useTaskActionPending("same", "work"), home: useTaskActionPending("same", "home") }));
    let pendingWork!: Promise<{ ok: boolean }>;
    await act(async () => { pendingWork = runTaskAction("same", "finish", work, "work"); });
    expect(result.current).toEqual({ work: true, home: false });
    expect(runTaskAction("same", "finish", work, "work")).toBe(pendingWork);
    await act(async () => { await runTaskAction("same", "finish", home, "home"); });
    expect(home).toHaveBeenCalledOnce();
    expect(work).toHaveBeenCalledOnce();
    await act(async () => { finishWork({ ok: true }); await pendingWork; });
    expect(result.current).toEqual({ work: false, home: false });
  });
});


it("opens the shared task menu with right-click and Shift+F10", () => {
  render(<WorkCard card={manual} presentation={resolveNextAction(manual, undefined, now)} onAction={vi.fn()} />);
  const card = screen.getByRole("article");
  fireEvent.contextMenu(card, { clientX: 20, clientY: 20 });
  // jsdom keeps manual popovers outside its accessibility tree.
  expect(document.querySelector('[role="menu"]')).toHaveAttribute("aria-label", `Card actions for ${manual.title}`);
  expect(document.querySelector('[data-menu-item="move-to"]')).toHaveTextContent("Move to");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(document.querySelector('[role="menu"]')).toHaveAttribute("hidden");
  fireEvent.keyDown(card, { key: "F10", shiftKey: true });
  expect(document.querySelector('[role="menu"]')).not.toHaveAttribute("hidden");
});

it("opens a PR from its menu through the desktop browser bridge", () => {
  const pr = { repo: "acme/app", number: 1, title: "Peer review", url: "https://github.com/acme/app/pull/1" };
  render(<WorkCard pr={pr} presentation={{ status: "Review requested", needsYou: true, action: null }} onAction={vi.fn()} />);
  fireEvent.contextMenu(screen.getByRole("article"));
  for (const item of ["Review with agent", "Open in Cursor", "Copy PR URL", "Skip until updated"]) expect(screen.getByText(item)).toBeInTheDocument();
  fireEvent.click(document.querySelector('[data-menu-item="github"]')!);
  expect(state.openBrowser).toHaveBeenCalledWith(pr.url);
});

it("leads with context, omits empty summaries on old cards and opens screenshot details", () => {
  const { rerender } = render(<WorkCard card={manual} presentation={resolveNextAction(manual, undefined, now)} onAction={vi.fn()} />);
  expect(screen.queryByText("No summary yet")).toBeNull();
  const card = { ...manual, summary: ["The layout now fits narrow screens."], latestScreenshot: { url: "/api/notes/assets/after.png", source: "note" as const } };
  rerender(<WorkCard card={card} presentation={resolveNextAction(card, undefined, now)} onAction={vi.fn()} onOpen={vi.fn()} />);
  expect(screen.getByText(card.summary[0])).toBeVisible();
  // The button shows the images itself; it must not just open the task panel.
  fireEvent.click(screen.getByRole("button", { name: `View screenshot for ${card.title}` }));
  expect(screen.getByRole("dialog", { name: /Images for/ })).toBeTruthy();
});

it("pauses after planning on direct Start without a dropdown", () => {
  const action = vi.fn();
  const card = { ...manual, status: "todo" as const, auto: undefined };
  render(<WorkCard card={card} presentation={resolveNextAction(card, undefined, now)} onAction={action} />);
  fireEvent.click(screen.getByRole("button", { name: "Start on auto" }));
  expect(action).toHaveBeenLastCalledWith({ kind: "start-auto", label: "Start on auto", pauseAfterPlan: true });
  expect(screen.queryByRole("button", { name: "Auto options" })).toBeNull();
});
