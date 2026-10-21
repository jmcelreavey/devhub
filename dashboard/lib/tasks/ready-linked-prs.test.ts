import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@shared/tasks/types.ts";
import type { TaskAgentRunRecord } from "@/lib/tasks/task-agent-runs";

const state = vi.hoisted(() => ({ tasks: [] as Task[] }));
vi.mock("@/lib/content/dirs", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/content/dirs")>(), getActiveTasksDir: () => "/tasks" }));
vi.mock("@/lib/tasks/task-note-sections", () => ({ updateTaskNoteSections: vi.fn() }));
vi.mock("@/lib/tasks/task-agent-runs", () => ({ listTaskAgentRuns: vi.fn(() => []) }));
vi.mock("@shared/tasks/store.ts", () => ({
  findTask: (_dir: string, id: string) => state.tasks.find((task) => task.id === id) ?? null,
  readItems: () => state.tasks,
}));

const { canonicalPrUrl, isCodeReviewStatus, linkedPrUrls, readyLinkedDraftPrs, taskIdsForJiraKey } = await import("./ready-linked-prs");

const task = (extra: Partial<Task> = {}): Task => ({ id: "t1", text: "PTF-1 thing", done: true, startDate: "2026-10-21", createdAt: "", ...extra } as Task);
const run = (extra: Partial<TaskAgentRunRecord> = {}): TaskAgentRunRecord => ({ runId: "r1", status: "done", startedAt: "", updatedAt: "", ...extra });
const PR = "https://github.com/acme/app/pull/7";

function fakeGh(views: Record<string, { state: string; isDraft: boolean; author?: string } | Error>, opts: { readyFails?: string } = {}) {
  const calls: string[][] = [];
  const gh = vi.fn(async (args: string[]) => {
    calls.push(args);
    if (args[0] === "api") return { stdout: "jmcelreavey\n" };
    const view = views[args[2]];
    if (args[1] === "view") {
      if (!view || view instanceof Error) throw view ?? new Error("not found");
      return { stdout: JSON.stringify({ state: view.state, isDraft: view.isDraft, author: { login: view.author ?? "jmcelreavey" } }) };
    }
    if (args[1] === "ready") {
      if (opts.readyFails === args[2]) throw Object.assign(new Error("exit 1"), { stderr: "GraphQL: Resource not accessible" });
      return { stdout: "" };
    }
    throw new Error("unexpected " + args.join(" "));
  });
  return { gh, calls };
}

beforeEach(() => { state.tasks = []; });

describe("canonicalPrUrl / linkedPrUrls", () => {
  it("normalises PR URLs and owner/repo#n ids, and ignores anything else", () => {
    expect(canonicalPrUrl("https://github.com/acme/app/pull/7/files")).toBe(PR);
    expect(canonicalPrUrl("acme/app#7")).toBe(PR);
    expect(canonicalPrUrl("https://github.com/acme/app/issues/7")).toBeNull();
    expect(canonicalPrUrl(undefined)).toBeNull();
  });

  it("merges pr links with implementation runs' PRs, deduplicated, skipping review runs", () => {
    const urls = linkedPrUrls(
      { links: [{ kind: "pr", id: "acme/app#7", label: "#7" }, { kind: "jira", id: "PTF-1", label: "PTF-1" }] },
      [run({ prUrl: PR }), run({ prUrl: "https://github.com/acme/app/pull/8" }), run({ role: "review", prUrl: "https://github.com/other/repo/pull/1" })],
    );
    expect(urls).toEqual([PR, "https://github.com/acme/app/pull/8"]);
  });
});

describe("readyLinkedDraftPrs", () => {
  it("readies only the user's own open drafts and logs each one", async () => {
    state.tasks = [task({ links: [{ kind: "pr", id: "acme/app#7", label: "#7" }] })];
    const { gh, calls } = fakeGh({
      [PR]: { state: "OPEN", isDraft: true },
      "https://github.com/acme/app/pull/8": { state: "OPEN", isDraft: false },
      "https://github.com/acme/app/pull/9": { state: "MERGED", isDraft: true },
      "https://github.com/acme/app/pull/10": { state: "OPEN", isDraft: true, author: "someone-else" },
    });
    const log = vi.fn();
    const runs = () => [8, 9, 10].map((n) => run({ prUrl: `https://github.com/acme/app/pull/${n}` }));
    const outcomes = await readyLinkedDraftPrs("t1", "task completed", { gh, runs, log });
    expect(outcomes.map((o) => o.result)).toEqual(["readied", "already-ready", "not-open", "not-mine"]);
    expect(calls.filter((args) => args[1] === "ready")).toEqual([["pr", "ready", PR]]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("t1", `Marked ${PR} ready for review (task completed).`);
  });

  it("is idempotent: a second pass over a ready PR changes and logs nothing", async () => {
    state.tasks = [task({ links: [{ kind: "pr", id: "acme/app#7", label: "#7", href: PR }] })];
    const { gh, calls } = fakeGh({ [PR]: { state: "OPEN", isDraft: false } });
    const log = vi.fn();
    expect(await readyLinkedDraftPrs("t1", "task completed", { gh, runs: () => [], log })).toEqual([{ url: PR, result: "already-ready" }]);
    expect(calls.some((args) => args[1] === "ready")).toBe(false);
    expect(log).not.toHaveBeenCalled();
  });

  it("writes failures to the task note instead of dropping them", async () => {
    state.tasks = [task()];
    const broken = "https://github.com/acme/app/pull/11";
    const { gh } = fakeGh({ [PR]: { state: "OPEN", isDraft: true }, [broken]: new Error("HTTP 502") }, { readyFails: PR });
    const log = vi.fn();
    const outcomes = await readyLinkedDraftPrs("t1", "PTF-1 moved to Code Review", { gh, runs: () => [run({ prUrl: PR }), run({ prUrl: broken })], log });
    expect(outcomes.map((o) => o.result)).toEqual(["failed", "failed"]);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0][1]).toMatch(/Couldn't mark .*pull\/7 ready for review \(PTF-1 moved to Code Review\): GraphQL: Resource not accessible\. Run `gh pr ready/);
    expect(log.mock.calls[1][1]).toMatch(/pull\/11.*couldn't read the PR: HTTP 502/);
  });

  it("does nothing for a task with no PRs, or one that doesn't exist", async () => {
    state.tasks = [task()];
    const { gh } = fakeGh({});
    expect(await readyLinkedDraftPrs("t1", "x", { gh, runs: () => [], log: vi.fn() })).toEqual([]);
    expect(await readyLinkedDraftPrs("missing", "x", { gh, runs: () => [], log: vi.fn() })).toEqual([]);
    expect(gh).not.toHaveBeenCalled();
  });
});

describe("Jira helpers", () => {
  it("recognises review statuses only", () => {
    expect(isCodeReviewStatus("Code Review")).toBe(true);
    expect(isCodeReviewStatus("In Review")).toBe(true);
    expect(isCodeReviewStatus("In Progress")).toBe(false);
    expect(isCodeReviewStatus("Done")).toBe(false);
    expect(isCodeReviewStatus(null)).toBe(false);
  });

  it("finds every task on a Jira key, case-insensitively", () => {
    state.tasks = [task({ id: "a", jiraKey: "PTF-1" }), task({ id: "b", jiraKey: "ptf-1", done: false }), task({ id: "c", jiraKey: "PTF-2" })];
    expect(taskIdsForJiraKey("PTF-1")).toEqual(["a", "b"]);
  });
});
