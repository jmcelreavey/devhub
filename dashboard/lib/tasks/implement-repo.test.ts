import { describe, expect, it } from "vitest";
import type { ResolvedLocalRepo } from "@/lib/repos/resolution";
import { selectListedRepo, selectTaskImplementationRepo } from "./implement-repo";

function candidate(name: string): ResolvedLocalRepo {
  return {
    fullName: "example-org/app-poc",
    repo: { name, path: `/repos/${name}` } as ResolvedLocalRepo["repo"],
  };
}

describe("selectTaskImplementationRepo", () => {
  it("prefers the canonical repo when a worktree shares its remote", () => {
    const result = selectTaskImplementationRepo("example-org/app-poc", [
      candidate("app-poc-ptf-4789"),
      candidate("app-poc"),
    ]);

    expect(result?.repo.path).toBe("/repos/app-poc");
  });

  it("reuses an existing worktree when it is the only local checkout", () => {
    const result = selectTaskImplementationRepo("example-org/app-poc", [candidate("app-poc-ptf-4789")]);

    expect(result?.repo.path).toBe("/repos/app-poc-ptf-4789");
  });

  it("supports short repo links without matching similarly named worktrees", () => {
    const result = selectTaskImplementationRepo("app-poc", [
      candidate("app-poc-ptf-4789"),
      candidate("app-poc"),
    ]);

    expect(result?.repo.path).toBe("/repos/app-poc");
  });
});

describe("selectListedRepo", () => {
  const repos = [
    { name: "sample-svc", path: "/Users/dev/sample-svc" },
    { name: "app", path: "/Users/dev/app" },
  ];

  it("prefers an existing checkout path when it is in the list", () => {
    expect(selectListedRepo(repos, { cwd: "/Users/dev/sample-svc", repoName: "app" })?.path).toBe("/Users/dev/sample-svc");
  });

  it("falls through to the assigned repo when cwd is not a listed checkout", () => {
    expect(selectListedRepo(repos, {
      cwd: "/Users/jmcelreavey/Library/Application Support/DevHub",
      repoName: "app",
    })?.path).toBe("/Users/dev/app");
  });

  it("matches owner/repo links to the local folder name", () => {
    expect(selectListedRepo(repos, { repoName: "Hearst/app" })?.name).toBe("app");
  });
});
