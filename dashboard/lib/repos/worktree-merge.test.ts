import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadMergedWorktreePrs, verifyWorktreeMerge } from "./worktree-merge";
import type { WorktreeInfo } from "./worktree-info";

const mocks = vi.hoisted(() => ({ gh: vi.fn(), git: vi.fn(), remote: vi.fn(), defaultBranch: vi.fn(), integrated: vi.fn() }));
vi.mock("./worktree-integration", () => ({ loadDefaultBranch: mocks.defaultBranch, isWorktreeIntegrated: mocks.integrated }));
vi.mock("@/lib/gh-exec", () => ({ execGhJsonArray: mocks.gh }));
vi.mock("@/lib/git/repo-local", () => ({ runGitRepoAsync: mocks.git }));
vi.mock("@/lib/repos", () => ({ getGithubFullNameForLocalRepo: mocks.remote }));
const head = "a".repeat(40);
const pr = { number: 12, url: "https://github.com/test/repo/pull/12", headRefName: "feature", headRefOid: head, mergedAt: "2026-10-01", isCrossRepository: false };
const tree: WorktreeInfo = { path: "/repo/tree", head, branch: "feature", isMain: false, detached: false, locked: false, lockReason: "", prunable: false, title: "Feature", tasks: [], notes: [], runs: [] };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.remote.mockReturnValue("test/repo");
  mocks.defaultBranch.mockResolvedValue({});
  mocks.integrated.mockResolvedValue(false);
  mocks.gh.mockImplementation(async (args: string[]) => args.includes("open") ? [] : [pr]);
  mocks.git.mockResolvedValue({ status: 1, stdout: "", stderr: "" });
});
describe("fresh worktree merge evidence", () => {
  it("shares concurrent previews but bypasses the cache for cleanup", async () => {
    mocks.remote.mockReturnValue("test/cached");
    await Promise.all([loadMergedWorktreePrs("/cached"), loadMergedWorktreePrs("/cached")]);
    expect(mocks.gh).toHaveBeenCalledTimes(2);
    await loadMergedWorktreePrs("/cached", [], true);
    expect(mocks.gh).toHaveBeenCalledTimes(4);
  });
  it("keeps open PRs even when the task finished or the changes appear integrated", async () => {
    mocks.integrated.mockResolvedValue(true);
    const lookup = { prs: [pr], openPrs: [{ ...pr, mergedAt: null }], defaultBranch: { name: "main", head, tree: head } };
    expect(await verifyWorktreeMerge(tree, lookup)).toEqual({ verified: false, reason: "PR #12 is still open", openPr: { number: 12, url: pr.url } });
    expect(mocks.integrated).not.toHaveBeenCalled();
  });
  it("checks older open PRs beyond the first page before trusting an older merge", async () => {
    mocks.gh.mockImplementation(async (args: string[]) => args.includes("open")
      ? args.includes("--head") ? [{ ...pr, mergedAt: null }] : Array.from({ length: 100 }, (_, i) => ({ ...pr, headRefName: `other-${i}`, mergedAt: null }))
      : [pr]);
    const lookup = await loadMergedWorktreePrs("/repo", ["feature"], true);
    expect(await verifyWorktreeMerge(tree, lookup)).toMatchObject({ verified: false, openPr: { number: 12 } });
  });
  it("recognises detached checkouts by their merged PR head", async () => {
    expect(await verifyWorktreeMerge({ ...tree, branch: null, detached: true }, { prs: [pr] })).toMatchObject({ verified: true, pr: { number: 12 } });
    expect(mocks.git).not.toHaveBeenCalled();
  });
  it("does not trust a reused branch name or recorded merged state", async () => {
    expect(await verifyWorktreeMerge({ ...tree, head: "b".repeat(40), pr: { url: pr.url, state: "merged" } }, { prs: [pr] })).toMatchObject({ verified: false });
  });
  it("accepts older commits included in the merged branch", async () => {
    mocks.git.mockResolvedValue({ status: 0, stdout: "", stderr: "" });
    expect(await verifyWorktreeMerge({ ...tree, head: "b".repeat(40) }, { prs: [pr] })).toMatchObject({ verified: true });
  });
  it("fails closed when GitHub or local ancestry cannot be checked", async () => {
    mocks.gh.mockRejectedValue(new Error("GitHub unavailable"));
    const lookup = await loadMergedWorktreePrs("/repo", [], true);
    expect(await verifyWorktreeMerge(tree, lookup)).toEqual({ verified: false, reason: "Could not verify GitHub merges. Check GitHub CLI access and refresh." });
    mocks.git.mockResolvedValue({ status: 128, stdout: "", stderr: "missing object" });
    expect(await verifyWorktreeMerge({ ...tree, head: "b".repeat(40) }, { prs: [pr] })).toMatchObject({ verified: false });
  });
  it("accepts equivalent default-branch changes even without a matching PR", async () => {
    mocks.integrated.mockResolvedValue(true);
    const result = await verifyWorktreeMerge(tree, { prs: [], defaultBranch: { name: "main", head: "b".repeat(40), tree: "c".repeat(40) } });
    expect(result).toEqual({ verified: true, reason: "Changes already included in main; no rebase needed" });
  });
  it("ignores fork branches with the same name and invalid head evidence", async () => {
    mocks.gh.mockResolvedValue([{ ...pr, isCrossRepository: true }, { ...pr, headRefOid: "" }]);
    expect((await loadMergedWorktreePrs("/repo", [], true)).prs).toEqual([]);
  });
  it("looks up older branches beyond the recent merged PR window", async () => {
    mocks.gh.mockImplementation(async (args: string[]) => args.includes("--head") ? [pr] : []);
    expect((await loadMergedWorktreePrs("/repo", ["feature", "feature"], true)).prs).toEqual([pr]);
    expect(mocks.gh).toHaveBeenCalledTimes(3);
    expect(mocks.gh.mock.calls[2][0]).toEqual(expect.arrayContaining(["--head", "feature"]));
  });
});
