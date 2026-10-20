import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ snapshots: {} as Record<string, unknown[]> }));
vi.mock("./answers", () => ({
  slackRouteContext: () => ({ activeProfile: "work", profiles: ["work", "personal"] }),
  loadSlackSnapshot: (profile: string) => ({ cards: mocks.snapshots[profile] ?? [] }),
}));
import { findSlackTasks } from "./task-lookup";

const card = (taskId: string, title: string, patch: Record<string, unknown> = {}) => ({ taskId, title, date: "2026-10-12", taskDone: false, task: { startDate: "2026-10-10", jiraKey: undefined }, jira: [], ...patch });
beforeEach(() => { mocks.snapshots = {}; });

describe("findSlackTasks by words", () => {
  it("matches tasks whose title has every word, in any case and order, and reports state", () => {
    mocks.snapshots.work = [card("a", "Fix the Ad Slot fallback"), card("b", "Ad copy review", { taskDone: true }), card("c", "Renew cert")];
    expect(findSlackTasks({ words: "slot AD" }, "work").map((match) => [match.taskId, match.done, match.date])).toEqual([["a", false, "2026-10-10"]]);
    expect(findSlackTasks({ words: "ad" }, "work").map((match) => [match.taskId, match.done])).toEqual([["a", false], ["b", true]]);
  });
  it("marks a task with live work as running", () => {
    mocks.snapshots.work = [card("a", "Fix the ad slot", { run: { status: "running" } }), card("b", "Fix the ad copy")];
    expect(findSlackTasks({ words: "fix" }, "work").map((match) => [match.taskId, match.running])).toEqual([["a", true], ["b", false]]);
  });
  it("tries the message's profile first and only then the others", () => {
    mocks.snapshots.work = [card("a", "Renew cert")];
    mocks.snapshots.personal = [card("p", "Renew passport")];
    expect(findSlackTasks({ words: "renew" }, "personal").map((match) => [match.taskId, match.profile])).toEqual([["p", "personal"]]);
    expect(findSlackTasks({ words: "passport" }, "work").map((match) => [match.taskId, match.profile])).toEqual([["p", "personal"]]);
    expect(findSlackTasks({ words: "nothing like it" }, "work")).toEqual([]);
  });
  it("still finds by Jira key and by task id", () => {
    mocks.snapshots.work = [card("a", "Fix", { task: { startDate: "2026-10-10", jiraKey: "PTF-1" }, jira: ["PTF-1"] })];
    expect(findSlackTasks({ jiraKey: "ptf-1" }, "work")).toHaveLength(1);
    expect(findSlackTasks({ taskId: "A" }, "work")).toHaveLength(1);
  });
});
