import { describe, expect, it } from "vitest";
import {
  catchUpLabel,
  matchesOwnIndexFilter,
  ownedCardMeta,
  ownIndexFilterCounts,
  presentOwnedIndex,
  prRadarCounts,
  type OwnedIndexSignals,
} from "./index-view";
import type { RepoPrRadarRow } from "./types";

function row(
  overrides: Partial<Omit<OwnedIndexSignals, "repo">> & {
    fullName?: string;
    /** Merged over the defaults, so a case can set just the field it is about. */
    repo?: Partial<OwnedIndexSignals["repo"]>;
  } = {},
): OwnedIndexSignals {
  const fullName = overrides.fullName ?? "acme/widgets";
  const name = fullName.split("/")[1]!;
  return {
    openPrs: 0,
    reviewRequested: 0,
    unattended: 0,
    attention: { score: 0 },
    error: null,
    ...overrides,
    repo: {
      fullName,
      name,
      lastVisited: null,
      localPath: "/tmp/widgets",
      localRepoName: name,
      ...(overrides.repo ?? {}),
    },
  };
}

function pr(overrides: Partial<RepoPrRadarRow> = {}): RepoPrRadarRow {
  return {
    number: 1,
    title: "Change",
    url: "https://github.com/acme/widgets/pull/1",
    author: { login: "alice", avatarUrl: null },
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    isDraft: false,
    files: [],
    domains: [],
    team: "@acme/core",
    review: { mineRequested: false, reviewedBy: [], nobodyLooking: false, decision: null },
    checks: "passing",
    stale: false,
    uncoveredPaths: [],
    ...overrides,
  };
}

describe("prRadarCounts", () => {
  it("keeps drafts in the open count but not the review queue", () => {
    expect(
      prRadarCounts([
        pr({
          review: { mineRequested: true, reviewedBy: [], nobodyLooking: false, decision: null },
        }),
        pr({
          number: 2,
          isDraft: true,
          review: { mineRequested: true, reviewedBy: [], nobodyLooking: false, decision: null },
        }),
        pr({
          number: 3,
          review: { mineRequested: false, reviewedBy: [], nobodyLooking: true, decision: null },
        }),
      ]),
    ).toEqual({ openPrs: 3, reviewRequested: 1, unattended: 1 });
  });
});

describe("presentOwnedIndex", () => {
  it("sorts by attention, then never-visited, then name", () => {
    const presented = presentOwnedIndex(
      [
        row({
          fullName: "acme/zeta",
          attention: { score: 1 },
          repo: { lastVisited: "2026-08-01T00:00:00.000Z" },
        }),
        row({ fullName: "acme/alpha", attention: { score: 1 }, repo: { lastVisited: null } }),
        row({ fullName: "acme/quiet", attention: { score: 0 } }),
        row({ fullName: "acme/hot", attention: { score: 10 } }),
      ],
      "all",
    );
    expect(presented.map((item) => item.repo.fullName)).toEqual([
      "acme/hot",
      "acme/alpha",
      "acme/zeta",
      "acme/quiet",
    ]);
  });

  it("filters neglected, review, open PRs, and missing clones", () => {
    const looked = "2026-08-12T00:00:00.000Z";
    const rows = [
      row({
        fullName: "acme/hot",
        attention: { score: 4 },
        reviewRequested: 1,
        openPrs: 2,
        repo: { lastVisited: looked },
      }),
      row({ fullName: "acme/prs", openPrs: 3, repo: { lastVisited: looked } }),
      row({
        fullName: "acme/remote",
        repo: { localPath: null, localRepoName: null, lastVisited: null },
      }),
      row({ fullName: "acme/quiet", repo: { lastVisited: looked } }),
    ];
    expect(presentOwnedIndex(rows, "neglected").map((item) => item.repo.fullName)).toEqual([
      "acme/hot",
      "acme/remote",
    ]);
    expect(presentOwnedIndex(rows, "review").map((item) => item.repo.fullName)).toEqual([
      "acme/hot",
    ]);
    expect(presentOwnedIndex(rows, "open-prs").map((item) => item.repo.fullName)).toEqual([
      "acme/hot",
      "acme/prs",
    ]);
    expect(presentOwnedIndex(rows, "missing-clone").map((item) => item.repo.fullName)).toEqual([
      "acme/remote",
    ]);
  });

  it("treats a failed summary as neglected, not as a review queue hit", () => {
    const failed = row({ fullName: "acme/broken", error: "boom", attention: { score: 0 } });
    expect(matchesOwnIndexFilter(failed, "neglected")).toBe(true);
    expect(matchesOwnIndexFilter(failed, "review")).toBe(false);
    expect(ownIndexFilterCounts([failed])).toMatchObject({ all: 1, neglected: 1, review: 0 });
  });
});

describe("owned card copy", () => {
  const now = Date.parse("2026-08-14T12:00:00.000Z");

  it("says never caught up until a watermark exists", () => {
    expect(catchUpLabel(null, now)).toBe("Never caught up");
    expect(catchUpLabel("nope", now)).toBe("Never caught up");
  });

  it("surfaces clone, PR, and last-look facts on one line", () => {
    expect(
      ownedCardMeta(
        row({
          openPrs: 3,
          reviewRequested: 1,
          repo: { lastVisited: "2026-08-12T12:00:00.000Z" },
        }),
        now,
      ),
    ).toBe("Local clone: widgets · 3 open PRs · 1 waiting on you · Last look 2d ago");
  });

  it("labels a missing clone without inventing a last look", () => {
    expect(
      ownedCardMeta(
        row({
          repo: { localPath: null, localRepoName: null, lastVisited: null },
        }),
        now,
      ),
    ).toBe("GitHub-only until cloned · 0 open PRs · Never caught up");
  });
});
