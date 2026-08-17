import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/gh-exec", () => ({
  execGh: vi.fn(),
}));
vi.mock("@/lib/git/conflicts", () => ({
  detectUnmergedFiles: vi.fn(() => []),
}));
vi.mock("@/lib/git/index-lock", () => ({
  looksLikeIndexLockError: vi.fn(() => false),
  prepareGitIndexWrite: vi.fn(() => ({ ok: true })),
}));
vi.mock("@/lib/git/repo-local", () => ({
  runGitRepoAsync: vi.fn(),
}));
vi.mock("@/lib/scanned-repo", () => ({
  findScannedRepoByGithubFullName: vi.fn(),
}));

import { execGh } from "@/lib/gh-exec";
import { detectUnmergedFiles } from "@/lib/git/conflicts";
import { prepareGitIndexWrite } from "@/lib/git/index-lock";
import { runGitRepoAsync } from "@/lib/git/repo-local";
import { findScannedRepoByGithubFullName } from "@/lib/scanned-repo";
import { checkoutPullRequestBranch, OpenPrCheckoutError } from "./open-pr-checkout";

const local = { name: "widgets", path: "/tmp/widgets" };

describe("checkoutPullRequestBranch", () => {
  beforeEach(() => {
    vi.mocked(execGh).mockReset();
    vi.mocked(runGitRepoAsync).mockReset();
    vi.mocked(findScannedRepoByGithubFullName).mockReset();
    vi.mocked(detectUnmergedFiles).mockReturnValue([]);
    vi.mocked(prepareGitIndexWrite).mockReturnValue({ ok: true });
    vi.mocked(findScannedRepoByGithubFullName).mockReturnValue(local);
  });

  it("skips checkout when already on the PR head branch", async () => {
    vi.mocked(execGh).mockResolvedValue({
      stdout: JSON.stringify({ headRefName: "feat/search" }),
      stderr: "",
    });
    vi.mocked(runGitRepoAsync).mockResolvedValue({ status: 0, stdout: "feat/search\n", stderr: "" });

    await expect(
      checkoutPullRequestBranch({ repo: "acme/widgets", number: 9 }),
    ).resolves.toEqual({
      localRepoName: "widgets",
      repoPath: "/tmp/widgets",
      branch: "feat/search",
      stashed: false,
      alreadyOnBranch: true,
    });

    expect(execGh).toHaveBeenCalledTimes(1);
    expect(execGh).toHaveBeenCalledWith([
      "pr",
      "view",
      "9",
      "--repo",
      "acme/widgets",
      "--json",
      "headRefName",
    ]);
  });

  it("stashes dirty work then checks out the PR without popping the stash", async () => {
    vi.mocked(execGh).mockImplementation(async (args) => {
      if (args[0] === "pr" && args[1] === "view") {
        return { stdout: JSON.stringify({ headRefName: "feat/search" }), stderr: "" };
      }
      return { stdout: "", stderr: "" };
    });
    vi.mocked(runGitRepoAsync).mockImplementation(async (_cwd, args) => {
      const cmd = args.join(" ");
      if (cmd === "branch --show-current") return { status: 0, stdout: "main\n", stderr: "" };
      if (cmd === "status --porcelain") return { status: 0, stdout: " M src/a.ts\n", stderr: "" };
      if (args[0] === "stash") return { status: 0, stdout: "Saved working directory\n", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    });

    const result = await checkoutPullRequestBranch({ repo: "acme/widgets", number: 9 });
    expect(result.stashed).toBe(true);
    expect(result.alreadyOnBranch).toBe(false);
    expect(execGh).toHaveBeenCalledWith(["pr", "checkout", "9", "--repo", "acme/widgets"], {
      cwd: "/tmp/widgets",
    });
    expect(runGitRepoAsync).toHaveBeenCalledWith("/tmp/widgets", [
      "stash",
      "push",
      "--include-untracked",
      "-m",
      "DevHub auto-stash before opening acme/widgets#9 (feat/search)",
    ]);
    expect(vi.mocked(runGitRepoAsync).mock.calls.some((call) => call[1]?.[0] === "stash" && call[1]?.[1] === "pop")).toBe(
      false,
    );
  });

  it("throws when there is no local clone", async () => {
    vi.mocked(findScannedRepoByGithubFullName).mockReturnValue(null);
    await expect(checkoutPullRequestBranch({ repo: "acme/missing", number: 1 })).rejects.toBeInstanceOf(
      OpenPrCheckoutError,
    );
  });

  it("checks out a clean worktree without stashing", async () => {
    vi.mocked(execGh).mockImplementation(async (args) => {
      if (args[0] === "pr" && args[1] === "view") {
        return { stdout: JSON.stringify({ headRefName: "feat/search" }), stderr: "" };
      }
      return { stdout: "", stderr: "" };
    });
    vi.mocked(runGitRepoAsync).mockImplementation(async (_cwd, args) => {
      const cmd = args.join(" ");
      if (cmd === "branch --show-current") return { status: 0, stdout: "main\n", stderr: "" };
      if (cmd === "status --porcelain") return { status: 0, stdout: "", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    });

    const result = await checkoutPullRequestBranch({ repo: "acme/widgets", number: 9 });
    expect(result.stashed).toBe(false);
    expect(result.alreadyOnBranch).toBe(false);
    expect(vi.mocked(runGitRepoAsync).mock.calls.some((call) => call[1]?.[0] === "stash")).toBe(false);
    expect(execGh).toHaveBeenCalledWith(["pr", "checkout", "9", "--repo", "acme/widgets"], {
      cwd: "/tmp/widgets",
    });
  });

  it("uses 404 when no local clone exists", async () => {
    vi.mocked(findScannedRepoByGithubFullName).mockReturnValue(null);
    try {
      await checkoutPullRequestBranch({ repo: "acme/missing", number: 1 });
      throw new Error("expected OpenPrCheckoutError");
    } catch (error) {
      expect(error).toBeInstanceOf(OpenPrCheckoutError);
      expect((error as OpenPrCheckoutError).status).toBe(404);
    }
  });
});
