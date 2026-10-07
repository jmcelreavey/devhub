import { describe, expect, it } from "vitest";
import {
  feedbackFingerprint,
  isSubstantive,
  pendingPrs,
  scoreComment,
  selectFeedback,
  substantiveComments,
  type FeedbackComment,
  type PrFeedback,
} from "./feedback";

/** Fixed clock: fixtures are dated 2026-10-05, and a real clock would age them out in 2028. */
const NOW = Date.parse("2026-10-06T00:00:00Z");

function comment(over: Partial<FeedbackComment> = {}): FeedbackComment {
  return {
    id: "c1",
    url: "https://github.com/o/r/pull/1#c1",
    author: "reviewer-a",
    isBot: false,
    association: "MEMBER",
    body: "our pattern for config is to allow more usage per system",
    at: "2026-10-05T10:00:00Z",
    kind: "inline",
    path: "config/default.js",
    ...over,
  };
}

function pr(number: number, comments: FeedbackComment[], author = "pr-author"): PrFeedback {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    state: "OPEN",
    author,
    updatedAt: "2026-10-05T10:00:00Z",
    comments,
  };
}

describe("isSubstantive", () => {
  it("keeps a team member's convention comment", () => {
    expect(isSubstantive(comment(), "pr-author", NOW)).toBe(true);
  });

  it("drops bots, by flag and by name", () => {
    expect(isSubstantive(comment({ isBot: true }), "pr-author", NOW)).toBe(false);
    expect(isSubstantive(comment({ author: "github-actions[bot]" }), "pr-author", NOW)).toBe(false);
    expect(isSubstantive(comment({ author: "codecov-commenter" }), "pr-author", NOW)).toBe(false);
  });

  it("drops the PR author's own replies, whatever the case", () => {
    expect(isSubstantive(comment({ author: "PR-Author" }), "pr-author", NOW)).toBe(false);
  });

  it("drops people outside the team but not unknown associations", () => {
    expect(isSubstantive(comment({ association: "NONE" }), "pr-author", NOW)).toBe(false);
    expect(isSubstantive(comment({ association: "CONTRIBUTOR" }), "pr-author", NOW)).toBe(false);
    expect(isSubstantive(comment({ association: "COLLABORATOR" }), "pr-author", NOW)).toBe(true);
    expect(isSubstantive(comment({ association: "" }), "pr-author", NOW)).toBe(true);
  });

  it("drops comments older than about 18 months, which old PRs touched by bots drag into 'recent'", () => {
    const years = comment({ at: "2019-03-01T10:00:00Z" });
    const justOver = comment({ at: "2025-03-01T10:00:00Z" }); // 584 days before NOW
    const justUnder = comment({ at: "2025-06-01T10:00:00Z" }); // 492 days before NOW
    expect(isSubstantive(years, "pr-author", NOW)).toBe(false);
    expect(isSubstantive(justOver, "pr-author", NOW)).toBe(false);
    expect(isSubstantive(justUnder, "pr-author", NOW)).toBe(true);
  });

  it("keeps a comment whose timestamp can't be read rather than silently dropping it", () => {
    expect(isSubstantive(comment({ at: "not a date" }), "pr-author", NOW)).toBe(true);
  });

  it("drops trivia and bodies with nothing left after cleaning", () => {
    expect(isSubstantive(comment({ body: "LGTM" }), "x", NOW)).toBe(false);
    expect(isSubstantive(comment({ body: "looks good to me, thanks" }), "x", NOW)).toBe(false);
    expect(isSubstantive(comment({ body: "> quoted reply only\n> more quoted text here" }), "x", NOW)).toBe(false);
    expect(isSubstantive(comment({ body: "too short" }), "x", NOW)).toBe(false);
  });
});

describe("scoreComment", () => {
  const body = (text: string) => text;

  it("ranks convention language, resolved threads and file anchors higher", () => {
    const plain = scoreComment(comment({ path: undefined }), body("why did you change this value here"));
    const convention = scoreComment(comment({ path: undefined }), body("our pattern is one file per handler"));
    const resolved = scoreComment(comment({ path: undefined, resolved: true }), body("why did you change this value here"));
    const anchored = scoreComment(comment({ path: "a.js" }), body("why did you change this value here"));
    expect(convention).toBeGreaterThan(plain);
    expect(resolved).toBeGreaterThan(plain);
    expect(anchored).toBeGreaterThan(plain);
  });

  it("ranks a comment the author acted on above one that was merely resolved", () => {
    const plain = scoreComment(comment({ path: undefined }), body("why did you change this value here"));
    const resolved = scoreComment(comment({ path: undefined, resolved: true }), body("why did you change this value here"));
    const acted = scoreComment(comment({ path: undefined, resolved: true, actedOn: true }), body("why did you change this value here"));
    expect(resolved).toBeGreaterThan(plain);
    expect(acted).toBeGreaterThan(resolved);
  });

  it("marks down nits without convention language, and bare review summaries", () => {
    const base = scoreComment(comment({ path: undefined }), body("rename this variable please"));
    expect(scoreComment(comment({ path: undefined }), body("nit: rename this variable"))).toBeLessThan(base);
    expect(scoreComment(comment({ path: undefined, kind: "review" }), body("rename this variable please"))).toBeLessThan(base);
  });

  it("does not mark down a nit that states a convention", () => {
    const plainNit = scoreComment(comment({ path: undefined }), body("nit: rename this variable"));
    const conventionNit = scoreComment(comment({ path: undefined }), body("nit: our convention is camelCase here"));
    expect(conventionNit).toBeGreaterThan(plainNit);
  });
});

describe("pendingPrs", () => {
  const withComments = pr(10, [comment({ id: "a" }), comment({ id: "b", body: "we always keep fixtures grouped by service" })]);
  const empty = pr(11, [comment({ body: "LGTM" })]);

  it("skips PRs with nothing substantive", () => {
    expect(pendingPrs([empty], {}, false, NOW)).toEqual([]);
  });

  it("returns PRs that were never mined", () => {
    expect(pendingPrs([withComments], {}, false, NOW)).toEqual([withComments]);
  });

  it("skips a PR whose feedback matches what was mined", () => {
    expect(pendingPrs([withComments], { "10": feedbackFingerprint(withComments, NOW) }, false, NOW)).toEqual([]);
  });

  it("re-mines legacy comment counts once so later resolutions are tracked", () => {
    expect(pendingPrs([withComments], { "10": 2 }, false, NOW)).toEqual([withComments]);
  });

  it("re-queues a PR when a reviewer adds a comment", () => {
    expect(pendingPrs([withComments], { "10": 1 }, false, NOW)).toEqual([withComments]);
  });

  it("re-reads everything when forced", () => {
    expect(pendingPrs([withComments], { "10": 2 }, true, NOW)).toEqual([withComments]);
  });
});

describe("selectFeedback", () => {
  it("numbers items from 1 and puts the newest PR first", () => {
    const older = pr(5, [comment({ id: "o", url: "u-old" })]);
    const newer = pr(9, [comment({ id: "n", url: "u-new" })]);
    const { items } = selectFeedback([older, newer], { now: NOW });
    expect(items.map((i) => [i.index, i.prNumber])).toEqual([
      [1, 9],
      [2, 5],
    ]);
  });

  it("keeps the highest-scoring comments when over the cap and reports how many it saw", () => {
    const low = comment({ id: "low", url: "low", path: undefined, body: "why was this value changed here exactly" });
    const high = comment({ id: "high", url: "high", resolved: true, body: "our pattern is one handler per file" });
    const { items, considered } = selectFeedback([pr(1, [low, high])], { maxItems: 1, now: NOW });
    expect(considered).toBe(2);
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe("high");
  });

  it("truncates long bodies and respects the character budget", () => {
    const long = comment({ id: "l", url: "l", body: `we always ${"x".repeat(2000)}` });
    const other = comment({ id: "o", url: "o", body: `our pattern is ${"y".repeat(300)}` });
    const { items } = selectFeedback([pr(1, [long, other])], { itemChars: 100, maxChars: 150, now: NOW });
    expect(items.every((i) => i.body.length <= 101)).toBe(true);
    expect(items.reduce((n, i) => n + i.body.length, 0)).toBeLessThanOrEqual(150);
  });

  it("carries the resolved and acted-on flags and the thread path through", () => {
    const { items } = selectFeedback([pr(1, [comment({ resolved: true, actedOn: true, path: "src/a.js" })])], { now: NOW });
    expect(items[0]).toMatchObject({ resolved: true, actedOn: true, path: "src/a.js", author: "reviewer-a" });
    const plain = selectFeedback([pr(1, [comment()])], { now: NOW }).items[0];
    expect(plain).toMatchObject({ resolved: false, actedOn: false });
  });

  it("counts only substantive comments", () => {
    expect(substantiveComments(pr(1, [comment(), comment({ id: "b", body: "LGTM" })]), NOW)).toHaveLength(1);
  });
});
