import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardCard, NotesBoard } from "@/lib/storyboard/notes-board-shared";
import type { Task } from "@/lib/tasks/types";
import type { GithubPrRow } from "@/lib/github/prs";
import type { TaskWorkflow } from "@/lib/workflows/types";

const state = vi.hoisted(() => ({ profile: "work", cards: [] as BoardCard[], boardErrors: [] as string[], workflows: [] as TaskWorkflow[], tasks: [] as Task[], authored: [] as GithubPrRow[], reviews: [] as GithubPrRow[], ownedRepos: ["acme/app"], githubFails: false }));
vi.mock("@/lib/ownership/owned-repos", () => ({ listOwnedRepos: () => state.ownedRepos.map((fullName) => ({ fullName })) }));
vi.mock("@/lib/tasks/storage", () => ({ ensureTasksMigrated: async () => {}, getTasks: async () => state.tasks, isTaskOpen: (task: Task) => !task.done && !task.abandonedAt }));
vi.mock("@/lib/jira/client", () => ({ getMyTickets: async () => [] }));
vi.mock("@/lib/github/prs", () => ({ readGithubPrsListCache: () => null, fetchMyGithubPrs: async () => { if (state.githubFails) throw new Error("GitHub unavailable"); return { authored: state.authored, reviews: state.reviews }; } }));
vi.mock("@/lib/share/share-content", () => ({ countStaleShares: () => 0 }));
vi.mock("@/lib/storyboard/notes-board", () => ({ readNotesBoard: (): NotesBoard => ({ cards: state.cards, columns: [], errors: state.boardErrors, generatedAt: "2026-10-18T12:00:00Z", hiddenDone: 0 }) }));
vi.mock("@/lib/workflows/store", () => ({ listWorkflows: () => state.workflows }));
vi.mock("@/lib/tasks/profile-request", () => ({ activeTaskProfile: () => state.profile, requestedTaskProfile: () => null, withTaskProfileRequest: (_profile: string, work: () => unknown) => work(), taskProfileConflict: (expected: string) => expected === state.profile ? null : Response.json({ error: "Profile changed" }, { status: 409 }) }));
import { GET } from "./route";
import { homeNeedsAction, homeWorkSummary } from "@/lib/storyboard/home-summary";
import { getSidebarCountsCache, invalidateSidebarCountsCache, setSidebarCountsCache } from "@/lib/sidebar-counts-cache";

const task = (id: string): Task => ({ id, text: id, done: false, rank: "a", startDate: "2026-10-18", createdAt: "2026-10-18T10:00:00Z" });
const card = (id: string, patch: Partial<BoardCard> = {}): BoardCard => ({ taskId: id, task: task(id), title: id, date: "2026-10-18", status: "todo", taskDone: false, notePath: null, noteHref: null, tags: [], links: [], models: [], summary: [], counts: { openQuestions: 0, openBugs: 0, blockerBugs: 0, decisions: 0 }, images: [], screenshot: null, jev: null, tiers: null, run: null, steps: [], attention: null, updatedAt: "2026-10-18T12:00:00Z", ...patch });
const pr = (number: number, patch: Partial<GithubPrRow> = {}): GithubPrRow => ({ repo: "acme/app", number, title: `PR ${number}`, url: `https://github.com/acme/app/pull/${number}`, checks: "passing", ...patch });
const get = () => GET(new Request("http://localhost/api/sidebar/counts"));

beforeEach(() => {
  invalidateSidebarCountsCache();
  state.profile = "work"; state.cards = []; state.boardErrors = []; state.workflows = []; state.tasks = []; state.authored = []; state.reviews = []; state.githubFails = false;
  state.ownedRepos = ["acme/app"];
});

describe("backward-compatible actionable sidebar counts", () => {
  it("retains inventory fields and counts only Home's Needs action tasks, not PRs", async () => {
    state.cards = [card("question", { noteHref: "/notes/question", counts: { openQuestions: 1, openBugs: 0, blockerBugs: 0, decisions: 0 } }), card("merged", { prState: "merged" }), card("ordinary")];
    state.tasks = state.cards.map((item) => item.task!);
    state.authored = Array.from({ length: 50 }, (_, index) => pr(index + 1, index === 0 ? { checks: "failing" } : {}));
    state.reviews = [pr(99), pr(99)];
    const result = await (await get()).json();
    expect(result).toMatchObject({ tasks: 3, tickets: 0, prs: 52, shared: 0, actionablePrs: 2, needsYou: 2, profile: "work", unavailable: [] });
    expect(result.signatures).toEqual({ tickets: expect.any(String), prs: expect.any(String) });
  });

  it("excludes team review requests and stale workflow attention on Done or explicitly To do tasks", async () => {
    state.cards = [card("jira-done", { status: "done" }), card("reset", { status: "todo", statusSetAt: "2026-10-18T11:00:00Z", run: { runId: "old", status: "failed", startedAt: "" } })];
    state.workflows = state.cards.map(({ taskId }) => ({ version: 1, taskId, revision: 1, seenRevision: 0, stage: "verify", status: "waiting-user", checks: [], reviews: [], events: [], proposals: [] }));
    state.authored = [pr(1, { repo: "other/mine", checks: "failing" })];
    state.reviews = [pr(2), pr(3, { repo: "team/other" })];
    // The Done card with a pending workflow is offered Finish under Home's Needs action, so it counts; PRs stay on the PRs badge.
    expect(await (await get()).json()).toMatchObject({ needsYou: 1, actionablePrs: 2, prs: 3 });
  });

  it("lets an explicit To do reset suppress an older failure with an empty startedAt", async () => {
    state.cards = [card("reset", {
      status: "todo", statusSetAt: "2026-10-18T11:00:00Z",
      run: { runId: "old", status: "failed", startedAt: "" },
      failure: { key: "old", summary: "Old run failed", runId: "old" },
    })];
    state.workflows = [{ version: 1, taskId: "reset", revision: 1, seenRevision: 0, stage: "verify", status: "waiting-user", checks: [], reviews: [], events: [], proposals: [] }];
    expect(await (await get()).json()).toMatchObject({ needsYou: 0, blockedWork: 0, reviewRequested: 0 });
  });

  it("counts a Done card with an open task, because Home offers Finish under Needs action", async () => {
    state.cards = [card("jira-done", { status: "done" })];
    state.tasks = state.cards.map((item) => item.task!);
    expect(await (await get()).json()).toMatchObject({ needsYou: 1, tasks: 1 });
  });

  it("includes read proposals outside needs-you and never imports another profile's workflows", async () => {
    state.cards = [card("proposal"), card("ordinary")];
    state.workflows = ["proposal", "foreign"].map((taskId) => ({ version: 1, taskId, revision: 1, seenRevision: 1, stage: "draft-pr", status: "waiting-user", checks: [], reviews: [], events: [], proposals: [{ id: "p", kind: "draft-pr", state: "pending", runId: "r", fingerprint: "abc", contentHash: "def", content: "PR", destination: "acme/app", expiresAt: "2027-01-01" }] }));
    expect(await (await get()).json()).toMatchObject({ needsYou: 1 });
  });

  it("doesn't manufacture zero actionable PRs when the best-effort metadata lookup is unavailable", async () => {
    state.authored = [pr(1, { checks: undefined })];
    expect(await (await get()).json()).toMatchObject({ prs: 1, actionablePrs: null, unavailable: ["github"] });
  });

  it("keeps count caches separate per profile, including identical task IDs", async () => {
    state.cards = [card("same", { status: "ready-for-review" })];
    expect(await (await get()).json()).toMatchObject({ profile: "work", needsYou: 1 });
    state.profile = "home";
    state.cards = [card("same")];
    expect(await (await get()).json()).toMatchObject({ profile: "home", needsYou: 0 });
    expect(getSidebarCountsCache("work")?.data.needsYou).toBe(1);
    expect(getSidebarCountsCache("home")?.data.needsYou).toBe(0);
    invalidateSidebarCountsCache();
    expect(getSidebarCountsCache("work")).toBeNull();
    expect(getSidebarCountsCache("home")).toBeNull();
  });

  it("reports unknown PR counts on a GitHub failure but still counts Needs action tasks", async () => {
    state.githubFails = true;
    state.cards = [card("review", { status: "ready-for-review" })];
    expect(await (await get()).json()).toMatchObject({ prs: 0, actionablePrs: null, needsYou: 1, unavailable: ["github"] });
  });

  it("retains last-known action counts on an outage without leaking them to another profile", async () => {
    setSidebarCountsCache({ tasks: 5, tickets: 0, prs: 84, shared: 0, needsYou: 4, actionablePrs: 3, profile: "work", signatures: { tickets: "", prs: "old-prs" } }, "work");
    const cached = getSidebarCountsCache("work")!;
    cached.ts -= 120_000;
    state.githubFails = true;
    expect(await (await get()).json()).toMatchObject({ actionablePrs: 3, needsYou: 0, prs: 84, unavailable: ["github"] });
    state.profile = "home";
    expect(await (await get()).json()).toMatchObject({ actionablePrs: null, needsYou: 0, profile: "home" });
  });

  it("doesn't publish a partial task source as a complete zero", async () => {
    state.boardErrors = ["Unreadable task item"];
    expect(await (await get()).json()).toMatchObject({ needsYou: null, unavailable: ["tasks"] });
  });
  it("Home badge always equals Home's Needs action list", async () => {
    state.cards = [
      card("question", { noteHref: "/notes/question", counts: { openQuestions: 1, openBugs: 0, blockerBugs: 0, decisions: 0 } }),
      card("review", { status: "ready-for-review" }),
      card("done-finish", { status: "done" }),
      card("plain-done", { status: "done" }),
      card("ordinary"),
    ];
    state.workflows = [{ version: 1, taskId: "done-finish", revision: 1, seenRevision: 0, stage: "verify", status: "waiting-user", checks: [], reviews: [], events: [], proposals: [] }];
    state.authored = [pr(1, { checks: "failing" }), pr(2, { reviewDecision: "CHANGES_REQUESTED" })];
    state.reviews = [pr(3), pr(4)];
    const items = state.workflows.map((workflow) => ({ task: state.cards.find((item) => item.taskId === workflow.taskId)!.task!, workflow }));
    const needsAction = homeNeedsAction(homeWorkSummary(state.cards, items, state.reviews, Date.parse("2026-10-18T12:00:00Z"), state.authored, state.ownedRepos));
    const result = await (await get()).json();
    expect(needsAction.length).toBeGreaterThan(0);
    expect(needsAction.every((work) => work.kind === "task")).toBe(true);
    expect(result.needsYou).toBe(needsAction.length);
    expect(result.actionablePrs).toBe(4);
  });
});
