/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
import { registerStartOnAutoHandler } from "@/lib/storyboard/start-on-auto-request";
import { RepoWorkHub } from "./RepoWorkHub";

const state = vi.hoisted(() => ({
  cards: [] as BoardCard[], error: undefined as Error | undefined, loading: false, profileError: undefined as Error | undefined,
  live: vi.fn(), refresh: vi.fn(), openTask: vi.fn(),
}));
vi.mock("@/lib/hooks/use-fetch", () => ({ useLive: state.live, defaultFetcher: vi.fn() }));
vi.mock("@/lib/storyboard/use-profile-work", () => ({
  useProfileWork: () => ({
    profile: { data: { active: "work" }, error: state.profileError, mutate: state.refresh }, profileId: "work",
    board: { data: state.loading ? undefined : { cards: state.cards, generatedAt: "2026-10-20T12:00:00Z" }, error: state.error, mutate: state.refresh },
    inbox: { data: { items: [] }, mutate: state.refresh },
  }),
}));
vi.mock("@/components/storyboard/TaskDetailProvider", () => ({
  useTaskDetail: () => ({ openTask: state.openTask, hrefForTask: (id: string) => `/repos/app?task=${id}&taskProfile=work` }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("swr", () => ({ mutate: vi.fn(), default: () => ({ data: undefined }) }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }) }));
vi.mock("@/components/repo-git/RepoGitWorkspace", () => ({ RepoGitWorkspace: () => <button>Open Git</button> }));
vi.mock("@/components/repo-git/HistoryPanel", () => ({ HistoryPanel: () => null }));
vi.mock("@/components/repo-git/HubWorkingTree", () => ({ HubWorkingTree: () => <p>Local files</p> }));
vi.mock("@/components/tasks/TaskComposer", () => ({ TaskComposer: () => <input aria-label="Add a task" /> }));

function card(id: string, patch: Partial<BoardCard> = {}): BoardCard {
  const taskId = id.toLowerCase().replaceAll(" ", "-");
  return { taskId, title: id, task: { id: taskId, text: id, done: false, startDate: "2026-10-20", createdAt: "", rank: "a", links: [{ kind: "repo", id: "app", label: "app" }] },
    date: "2026-10-20", status: "todo", taskDone: false, repo: "app", notePath: null, noteHref: null,
    tags: [], links: [], models: [], summary: [], counts: { openQuestions: 0, openBugs: 0, blockerBugs: 0, decisions: 0 },
    images: [], screenshot: null, jev: null, tiers: null, run: null, steps: [], attention: null, updatedAt: "2026-10-20T11:59:00Z", ...patch };
}
const repo = { name: "app", path: "/tmp/acme/app", branch: "main", remote: null, dirtyCount: 0 };
function renderHub() { return render(<RepoWorkHub repo={repo} onMutate={vi.fn()} />); }

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  state.cards = [];
  state.error = undefined; state.profileError = undefined; state.loading = false;
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
  state.live.mockImplementation((key: string | null) => {
    if (key === "/api/repos/app/work") return { data: { date: "2026-10-20", fullName: "acme/app", openPrs: [], myPrUrls: [], model: { clusters: [], leftoverTasks: [], leftoverNotes: [], leftoverEvents: [], openTickets: [] } }, mutate: state.refresh };
    if (key === "/api/storyboard/orchestrate") return { data: { orchestrations: state.cards.filter((card) => card.auto).map((card) => ({ taskId: card.taskId, status: card.auto!.status, executionStep: "implement", runCount: 1, openQuestions: 0, auto: card.auto })) }, mutate: state.refresh };
    if (key === "/api/tasks/agent-runs/summary") return { data: { tasks: {} }, mutate: state.refresh };
    return { data: undefined, mutate: state.refresh };
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("repo tasks use the shared auto flow", () => {
  it("opens the task panel and sends Start on auto to the shared launch sheet", () => {
    state.cards = [card("Improve search")];
    const launch = vi.fn();
    const unregister = registerStartOnAutoHandler(launch);
    try {
      renderHub();
      const row = within(screen.getByRole("article", { name: "Improve search" }));
      fireEvent.click(row.getByRole("link", { name: "Improve search" }));
      expect(state.openTask).toHaveBeenCalledWith("improve-search", "plan");
      fireEvent.click(row.getByRole("button", { name: "Start on auto" }));
      expect(launch).toHaveBeenCalledWith(state.cards[0]);
      expect(fetch).not.toHaveBeenCalled();
      expect(row.queryByRole("button", { name: "Implement" })).toBeNull();
      expect(row.queryByRole("button", { name: "Create PR" })).toBeNull();
      expect(row.queryByRole("button", { name: /Upstart/ })).toBeNull();
    } finally { unregister(); }
  });

  it("shows Auto on running work without offering a second manual launch", async () => {
    state.cards = [card("Build settings", { status: "in-progress", auto: { status: "running", phase: "implement", label: "Implementing", round: 0, maxRounds: 3 } })];
    renderHub();
    const row = screen.getByRole("article", { name: "Build settings" });
    expect(within(row).getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect(within(row).queryByRole("button", { name: "Start on auto" })).toBeNull();
    fireEvent.contextMenu(row);
    // jsdom does not implement the Popover API used by the shared menu.
    const menuElement = await screen.findByRole("menu", { hidden: true });
    expect(menuElement).not.toHaveAttribute("hidden");
    const menu = within(menuElement);
    expect(menu.getByRole("menuitem", { name: /^Implement with Agent/, hidden: true })).toBeDisabled();
    expect(menu.queryByRole("menuitem", { name: /^Create PR/, hidden: true })).toBeNull();
    expect(menu.queryByRole("menuitem", { name: /^Start on auto/, hidden: true })).toBeNull();
  });

  it("keeps failure reasons visible and offers recovery", () => {
    state.cards = [card("Repair search", { status: "blocked", failure: { key: "check", summary: "Search check failed" } })];
    renderHub();
    const row = within(screen.getByRole("article", { name: "Repair search" }));
    expect(row.getByText("Search check failed").closest(".sr-only")).toBeNull();
    expect(row.getByRole("button", { name: "Retry" })).toBeEnabled();
  });

  it("does not offer launches when workflow state is unavailable", () => {
    state.cards = [card("Improve search")]; state.error = new Error("Unavailable");
    renderHub();
    expect(screen.getByText("Task status unavailable. Refresh before starting work.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start on auto" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(state.refresh).toHaveBeenCalled();
  });

  it("hides tasks when the active profile cannot be confirmed", () => {
    state.cards = [card("Improve search")]; state.profileError = new Error("Unavailable");
    renderHub();
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.getByText("Couldn’t confirm the task profile.")).toBeInTheDocument();
  });

  it("distinguishes loading from an empty repo", () => {
    state.loading = true;
    const view = renderHub();
    expect(screen.queryByText("No active work. Add a task to start on auto.")).toBeNull();
    state.loading = false;
    view.rerender(<RepoWorkHub repo={repo} onMutate={vi.fn()} />);
    expect(screen.getByText("No active work. Add a task to start on auto.")).toBeInTheDocument();
  });
});
