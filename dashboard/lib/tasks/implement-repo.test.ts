import { describe, expect, it } from "vitest";
import type { ResolvedLocalRepo } from "@/lib/repos/resolution";
import { selectTaskImplementationRepo } from "./implement-repo";

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
