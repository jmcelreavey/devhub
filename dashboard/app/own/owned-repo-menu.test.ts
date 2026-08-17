import { describe, expect, it, vi } from "vitest";
import type { ResolvedOwnedRepo } from "@/lib/ownership/types";
import {
  OWNED_REPO_CLONE_FIRST,
  buildOwnedRepoMenuGroups,
  ownedRepoCatchUpHref,
  ownedRepoCloneUrl,
  ownedRepoGapsHref,
  ownedRepoHref,
  ownedRepoPullsUrl,
  type OwnedRepoMenuActions,
} from "./owned-repo-menu";

const actions: OwnedRepoMenuActions = {
  onOpenCursor: vi.fn(),
  onOpenGitWorkspace: vi.fn(),
  onOpenGithub: vi.fn(),
  onOpenRadar: vi.fn(),
  onOpenCatchUp: vi.fn(),
  onOpenPrs: vi.fn(),
  onCopyCloneUrl: vi.fn(),
  onCopyFullName: vi.fn(),
  onReveal: vi.fn(),
  onUpstart: vi.fn(),
  onClone: vi.fn(),
  onLearn: vi.fn(),
  onKnowledgeGaps: vi.fn(),
  onScopeCreep: vi.fn(),
  onStopOwning: vi.fn(),
};

function owned(overrides: Partial<ResolvedOwnedRepo> = {}): ResolvedOwnedRepo {
  return {
    name: "example-service",
    fullName: "example-org/example-service",
    owner: "example-org",
    addedAt: "2026-01-01",
    lastVisited: null,
    lastSeenSha: null,
    domains: null,
    teams: null,
    localRepoName: "example-service",
    localPath: "/tmp/example-service",
    url: "https://github.com/example-org/example-service",
    defaultBranch: "master",
    ...overrides,
  };
}

function labels(repo: ResolvedOwnedRepo, extra: Partial<Parameters<typeof buildOwnedRepoMenuGroups>[0]> = {}) {
  return buildOwnedRepoMenuGroups(
    {
      repo,
      revealLabel: "Reveal in Finder",
      busy: false,
      opening: false,
      cloning: false,
      hasUpstart: true,
      ...extra,
    },
    actions,
  ).flatMap((group) => group.items.map((item) => item.label));
}

function item(
  repo: ResolvedOwnedRepo,
  id: string,
  extra: Partial<Parameters<typeof buildOwnedRepoMenuGroups>[0]> = {},
) {
  return buildOwnedRepoMenuGroups(
    {
      repo,
      revealLabel: "Reveal in Finder",
      busy: false,
      opening: false,
      cloning: false,
      hasUpstart: true,
      ...extra,
    },
    actions,
  )
    .flatMap((group) => group.items)
    .find((entry) => entry.id === id);
}

describe("owned repo menu groups", () => {
  it("includes Cursor, GitHub, and stop owning", () => {
    const names = labels(owned());
    expect(names).toContain("Open in Cursor");
    expect(names).toContain("Open on GitHub");
    expect(names).toContain("Stop owning");
  });

  it("includes catch-up in the ownership group", () => {
    const groups = buildOwnedRepoMenuGroups(
      {
        repo: owned(),
        revealLabel: "Reveal in Finder",
        busy: false,
        opening: false,
        cloning: false,
        hasUpstart: true,
      },
      actions,
    );
    const own = groups.find((group) => group.id === "own");
    expect(own?.items.map((item) => item.id)).toContain("catch-up");
  });

  it("groups Open / Work / Ownership", () => {
    const groups = buildOwnedRepoMenuGroups(
      {
        repo: owned(),
        revealLabel: "Reveal in Finder",
        busy: false,
        opening: false,
        cloning: false,
        hasUpstart: true,
      },
      actions,
    );
    expect(groups.map((group) => group.id)).toEqual(["open", "work", "own"]);
    expect(groups.map((group) => group.label)).toEqual(["Open", "Work", "Ownership"]);
  });

  it("disables clone-gated items when there is no local clone", () => {
    const remote = owned({ localPath: null, localRepoName: null });
    expect(item(remote, "cursor")?.disabled).toBe(true);
    expect(item(remote, "cursor")?.disabledReason).toBe(OWNED_REPO_CLONE_FIRST);
    expect(item(remote, "git")?.disabled).toBe(true);
    expect(item(remote, "reveal")?.disabled).toBe(true);
    expect(item(remote, "upstart")?.disabled).toBe(true);
    expect(item(remote, "scope")?.disabled).toBe(true);
    expect(item(remote, "learn")?.disabled).toBe(true);
    expect(item(remote, "github")?.disabled).toBeUndefined();
    expect(item(remote, "remove")?.danger).toBe(true);
    expect(item(remote, "clone")?.label).toBe("Clone");
  });

  it("skips Clone once a local copy exists and enables Cursor", () => {
    const names = labels(owned());
    expect(names).not.toContain("Clone");
    expect(item(owned(), "cursor")?.disabled).toBeUndefined();
    expect(item(owned(), "cursor")?.disabledReason).toBeUndefined();
  });
});

describe("owned repo menu urls", () => {
  it("builds radar, gaps, clone, and pulls urls", () => {
    expect(ownedRepoHref("example-org/example-service")).toBe("/own/example-org/example-service");
    expect(ownedRepoGapsHref("example-org/example-service")).toBe("/own/example-org/example-service#gaps");
    expect(ownedRepoCatchUpHref("example-org/example-service")).toBe("/own/example-org/example-service#catch-up");
    expect(ownedRepoCloneUrl("https://github.com/example-org/example-service")).toBe(
      "https://github.com/example-org/example-service.git",
    );
    expect(ownedRepoPullsUrl("https://github.com/example-org/example-service")).toBe(
      "https://github.com/example-org/example-service/pulls",
    );
  });
});
