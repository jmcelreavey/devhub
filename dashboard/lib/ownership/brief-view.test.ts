import { describe, expect, it } from "vitest";
import {
  filterPrRadar,
  presentRepoOwners,
  prRadarFilterCounts,
  rankPrRadar,
} from "./brief-view";
import type { RepoDomain, RepoPrRadarRow, RepoTeam } from "./types";

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

describe("rankPrRadar", () => {
  it("puts review-requested ahead of unattended, stale, and drafts", () => {
    const ranked = rankPrRadar([
      pr({ number: 4, isDraft: true, updatedAt: "2026-08-14T00:00:00.000Z" }),
      pr({ number: 3, stale: true, updatedAt: "2026-08-13T00:00:00.000Z" }),
      pr({
        number: 2,
        review: { mineRequested: false, reviewedBy: [], nobodyLooking: true, decision: null },
        updatedAt: "2026-08-12T00:00:00.000Z",
      }),
      pr({
        number: 1,
        review: { mineRequested: true, reviewedBy: [], nobodyLooking: false, decision: null },
        updatedAt: "2026-08-01T00:00:00.000Z",
      }),
    ]);
    expect(ranked.map((row) => row.number)).toEqual([1, 2, 3, 4]);
  });
});

describe("filterPrRadar", () => {
  const prs = [
    pr({
      number: 1,
      review: { mineRequested: true, reviewedBy: [], nobodyLooking: false, decision: null },
    }),
    pr({
      number: 2,
      review: { mineRequested: false, reviewedBy: [], nobodyLooking: true, decision: null },
    }),
    pr({ number: 3, stale: true }),
    pr({
      number: 4,
      isDraft: true,
      review: { mineRequested: true, reviewedBy: [], nobodyLooking: false, decision: null },
    }),
  ];

  it("counts live review / unattended / stale separately from drafts", () => {
    expect(prRadarFilterCounts(prs)).toEqual({ all: 4, review: 1, unattended: 1, stale: 1 });
  });

  it("drops drafts from the review queue", () => {
    expect(filterPrRadar(prs, "review").map((row) => row.number)).toEqual([1]);
  });
});

describe("presentRepoOwners", () => {
  const domains: RepoDomain[] = [
    {
      id: "api",
      label: "apps/api",
      paths: ["apps/api"],
      source: "codeowners",
      codeowners: ["@acme/api"],
    },
    { id: "web", label: "apps/web", paths: ["apps/web"], source: "directory", codeowners: [] },
  ];

  it("lists CODEOWNERS as declared and churn teams as inferred", () => {
    const teams: RepoTeam[] = [
      { id: "acme-api", label: "@acme/api", source: "codeowners", domains: ["api"], members: [] },
      {
        id: "churn-web",
        label: "~apps/web",
        source: "churn",
        domains: ["web"],
        members: ["ada@acme.test"],
      },
    ];
    expect(presentRepoOwners(domains, teams)).toEqual({
      declared: [
        {
          domainId: "api",
          label: "apps/api",
          codeowners: ["@acme/api"],
          teamLabel: "@acme/api",
          teamSource: "codeowners",
        },
      ],
      inferred: [
        {
          id: "churn-web",
          label: "~apps/web",
          members: ["ada@acme.test"],
          domainLabels: ["apps/web"],
        },
      ],
    });
  });

  it("does not invent declared owners from churn", () => {
    const teams: RepoTeam[] = [
      {
        id: "churn-web",
        label: "~apps/web",
        source: "churn",
        domains: ["web"],
        members: ["ada@acme.test"],
      },
    ];
    const view = presentRepoOwners(
      [{ id: "web", label: "apps/web", paths: ["apps/web"], source: "directory", codeowners: [] }],
      teams,
    );
    expect(view.declared).toEqual([]);
    expect(view.inferred).toHaveLength(1);
  });
});
