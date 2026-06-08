import { describe, it, expect } from "vitest";
import { buildStandupMarkdown } from "./standup-markdown";
import type { StandupMergedPr } from "./standup-github-merged";

const EMPTY: Parameters<typeof buildStandupMarkdown>[0] = {
  localToday: "2026-05-14",
  jiraConfigured: false,
  jiraActivity: [],
  jiraTruncated: false,
  mergedAuthored: [],
  mergedReviewedOthers: [],
  prsCreated: [],
  tasksCompleted: [],
  gitCommitsByRepo: {},
};

const PR_OPEN: StandupMergedPr = {
  title: "Add thing",
  url: "https://github.com/foo/bar/pull/1",
  repo: "foo/bar",
  number: 1,
  mergedAt: "",
  createdAt: "2026-05-14T09:00:00Z",
  state: "open",
};

const PR_MERGED: StandupMergedPr = {
  title: "Ship thing",
  url: "https://github.com/foo/bar/pull/2",
  repo: "foo/bar",
  number: 2,
  mergedAt: "2026-05-14T12:00:00Z",
  createdAt: "2026-05-13T09:00:00Z",
  state: "merged",
};

describe("buildStandupMarkdown", () => {
  it("renders an empty standup with all section markers", () => {
    const md = buildStandupMarkdown(EMPTY);
    expect(md).toContain("# Standup — 2026-05-14");
    expect(md).toContain("## Tasks completed today");
    expect(md).toContain("## PRs");
    expect(md).toContain("## PRs reviewed");
    expect(md).toContain("## Jira");
    expect(md).toContain("## Git commits");
    expect(md).toContain("_No commits in this window._");
    expect(md).toContain("_Jira not configured._");
  });

  it("tasks section appears before PRs section", () => {
    const md = buildStandupMarkdown({
      ...EMPTY,
      tasksCompleted: [{ text: "Do the thing" }],
    });
    expect(md.indexOf("## Tasks completed today")).toBeLessThan(md.indexOf("## PRs"));
  });

  it("groups git commits by repo alphabetically", () => {
    const md = buildStandupMarkdown({
      ...EMPTY,
      gitCommitsByRepo: {
        zebra: { subjects: ["z1"], truncated: false },
        alpha: { subjects: ["a1", "a2"], truncated: true },
      },
    });
    expect(md.indexOf("### alpha")).toBeLessThan(md.indexOf("### zebra"));
    expect(md).toContain("- a1");
    expect(md).toContain("- a2");
    expect(md).toContain("_…truncated_");
    expect(md).toContain("- z1");
  });

  it("renders PR rows with title link, repo ref link, and state", () => {
    const md = buildStandupMarkdown({ ...EMPTY, prsCreated: [PR_OPEN] });
    expect(md).toMatch(
      /- \[Add thing\]\(https:\/\/github\.com\/foo\/bar\/pull\/1\) — \[foo\/bar#1\]\(https:\/\/github\.com\/foo\/bar\/pull\/1\) — open/,
    );
  });

  it("dedupes PRs that appear in both mergedAuthored and prsCreated", () => {
    const md = buildStandupMarkdown({
      ...EMPTY,
      mergedAuthored: [PR_MERGED],
      prsCreated: [PR_MERGED],
    });
    const count = (md.match(/foo\/bar#2/g) ?? []).length;
    expect(count).toBe(1);
  });

  it("shows merged PRs before open PRs", () => {
    const md = buildStandupMarkdown({
      ...EMPTY,
      mergedAuthored: [PR_MERGED],
      prsCreated: [PR_OPEN],
    });
    expect(md.indexOf("Ship thing")).toBeLessThan(md.indexOf("Add thing"));
  });

  it("shows merged date for authored PRs but not for reviewed PRs", () => {
    const md = buildStandupMarkdown({
      ...EMPTY,
      mergedAuthored: [PR_MERGED],
      mergedReviewedOthers: [PR_MERGED],
    });
    // authored section: one "merged <date>" entry
    const authoredIdx = md.indexOf("## PRs\n");
    const reviewedIdx = md.indexOf("## PRs reviewed\n");
    const authoredSection = md.slice(authoredIdx, reviewedIdx);
    const reviewedSection = md.slice(reviewedIdx, md.indexOf("## Jira"));
    expect(authoredSection).toMatch(/merged \w+ \d+/); // has date
    expect(reviewedSection).not.toMatch(/merged \w+ \d+/); // no date
    expect(reviewedSection).toContain("— merged");
  });
});
