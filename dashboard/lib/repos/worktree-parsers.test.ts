import { describe, expect, it } from "vitest";
import {
  defaultWorktreePath,
  parseWorktreeList,
  worktreePathError,
  worktreeSlug,
} from "@/lib/repos/worktree-parsers";

describe("parseWorktreeList", () => {
  it("parses the main worktree", () => {
    const [main] = parseWorktreeList(
      "worktree /Users/j/Developer/acme-app\nHEAD 48cbd344\nbranch refs/heads/job-search-agent\n",
    );
    expect(main).toMatchObject({
      path: "/Users/j/Developer/acme-app",
      head: "48cbd344",
      branch: "job-search-agent",
      isMain: true,
      detached: false,
    });
  });

  it("marks only the first record as main", () => {
    // The main working tree cannot be removed, so getting this wrong would offer
    // an action that always fails.
    const trees = parseWorktreeList(
      [
        "worktree /repo\nHEAD aaa\nbranch refs/heads/main",
        "worktree /repo--feature\nHEAD bbb\nbranch refs/heads/feature",
      ].join("\n\n"),
    );
    expect(trees.map((t) => t.isMain)).toEqual([true, false]);
  });

  it("reads a detached worktree as having no branch", () => {
    const [tree] = parseWorktreeList("worktree /repo--detached\nHEAD ccc\ndetached\n");
    expect(tree).toMatchObject({ branch: null, detached: true });
  });

  it("captures a lock and its reason", () => {
    const [, locked] = parseWorktreeList(
      ["worktree /repo\nHEAD aaa", "worktree /mnt/usb/wt\nHEAD bbb\nlocked on removable media"].join(
        "\n\n",
      ),
    );
    expect(locked).toMatchObject({ locked: true, lockReason: "on removable media" });
  });

  it("handles a lock with no reason", () => {
    const [, locked] = parseWorktreeList(
      ["worktree /repo\nHEAD aaa", "worktree /wt\nHEAD bbb\nlocked"].join("\n\n"),
    );
    expect(locked).toMatchObject({ locked: true, lockReason: "" });
  });

  it("flags a prunable worktree", () => {
    const [, gone] = parseWorktreeList(
      ["worktree /repo\nHEAD aaa", "worktree /gone\nHEAD bbb\nprunable gitdir file points to non-existent location"].join("\n\n"),
    );
    expect(gone?.prunable).toBe(true);
  });

  it("ignores a record with no path rather than emitting a blank row", () => {
    expect(parseWorktreeList("HEAD aaa\nbranch refs/heads/x")).toEqual([]);
    expect(parseWorktreeList("")).toEqual([]);
  });
});

describe("worktreeSlug", () => {
  it("makes a branch name safe for a directory", () => {
    expect(worktreeSlug("feature/immersive-mode")).toBe("feature-immersive-mode");
    expect(worktreeSlug("PTF-4356")).toBe("PTF-4356");
  });

  it("strips the ref prefix", () => {
    expect(worktreeSlug("refs/heads/main")).toBe("main");
  });

  it("never returns an empty string", () => {
    expect(worktreeSlug("///")).toBe("worktree");
    expect(worktreeSlug("")).toBe("worktree");
  });
});

describe("defaultWorktreePath", () => {
  it("proposes a sibling of the repository", () => {
    // Sibling, so it lands in the same scan directory and DevHub lists it as a
    // repo of its own — which is what you want when handing it to an agent.
    expect(defaultWorktreePath("/Users/j/Developer/acme-app", "feature/x")).toBe(
      "/Users/j/Developer/acme-app--feature-x",
    );
  });

  it("tolerates a trailing slash on the repo root", () => {
    expect(defaultWorktreePath("/Users/j/Developer/acme-app/", "main")).toBe(
      "/Users/j/Developer/acme-app--main",
    );
  });
});

describe("worktreePathError", () => {
  const root = "/Users/j/Developer/acme-app";

  it("accepts a sibling path", () => {
    expect(worktreePathError(root, "/Users/j/Developer/acme-app--x")).toBeNull();
  });

  it("rejects a path inside the repository", () => {
    // A checkout nested in its own working tree shows up as untracked files.
    expect(worktreePathError(root, `${root}/wt`)).toMatch(/outside the repository/);
  });

  it("rejects the repository root itself", () => {
    expect(worktreePathError(root, root)).toMatch(/repository itself/);
    expect(worktreePathError(root, `${root}/`)).toMatch(/repository itself/);
  });

  it("rejects traversal and relative paths", () => {
    // The value reaches a git argv, so it is checked rather than trusted.
    expect(worktreePathError(root, "../evil")).toMatch(/absolute/);
    expect(worktreePathError(root, "/Users/j/../../etc/wt")).toMatch(/'\.\.'/);
  });

  it("rejects an empty path", () => {
    expect(worktreePathError(root, "   ")).toMatch(/Choose a folder/);
  });

  it("does not confuse a sibling with a prefix match", () => {
    // "/repo-other" starts with "/repo" as a string but is not inside it.
    expect(worktreePathError("/repo", "/repo-other")).toBeNull();
  });
});
