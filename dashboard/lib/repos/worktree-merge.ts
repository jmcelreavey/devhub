import { execGhJsonArray } from "@/lib/gh-exec";
import { runGitRepoAsync } from "@/lib/git/repo-local";
import { getGithubFullNameForLocalRepo } from "@/lib/repos";
import { ttlCached, type TtlPromiseEntry } from "@/lib/ttl-cache";
import type { WorktreeInfo, WorktreeMerge } from "./worktree-info";
import { isWorktreeIntegrated, loadDefaultBranch, type DefaultBranchEvidence } from "./worktree-integration";

interface WorktreePr {
  number: number;
  url: string;
  headRefName: string;
  headRefOid: string;
  mergedAt: string | null;
  isCrossRepository: boolean;
}

interface MergedPr extends WorktreePr { mergedAt: string }

export interface MergedWorktreePrs {
  prs: MergedPr[];
  openPrs?: WorktreePr[];
  error?: string;
  defaultBranch?: DefaultBranchEvidence;
  defaultBranchError?: string;
}

const fields = "number,url,headRefName,headRefOid,mergedAt,isCrossRepository";
const previewCache = new Map<string, TtlPromiseEntry<WorktreePr[]>>();

function readMergedPrs(repo: string, branch: string | undefined, fresh: boolean, state: "merged" | "open" = "merged"): Promise<WorktreePr[]> {
  const read = () => execGhJsonArray<WorktreePr>(["pr", "list", "-R", repo, "--state", state,
    "--limit", branch ? "20" : "100", "--json", fields, ...(branch ? ["--head", branch] : [])]);
  return fresh ? read() : ttlCached(previewCache, JSON.stringify([repo, branch, state]), 60_000, read);
}

async function loadPrEvidence(repoRoot: string, branches: string[], fresh: boolean): Promise<MergedWorktreePrs> {
  const repo = getGithubFullNameForLocalRepo(repoRoot);
  if (!repo) return { prs: [], error: "No GitHub remote to verify merges" };
  try {
    const [recent, open] = await Promise.all([readMergedPrs(repo, undefined, fresh), readMergedPrs(repo, undefined, fresh, "open")]);
    const prs = [...recent];
    const openPrs = open.filter((pr) => !pr.isCrossRepository);
    if (open.length === 100) {
      const unchecked = [...new Set(branches)].filter((branch) => !openPrs.some((pr) => pr.headRefName === branch));
      for (let start = 0; start < unchecked.length; start += 4) {
        const olderOpen = await Promise.all(unchecked.slice(start, start + 4).map((branch) => readMergedPrs(repo, branch, fresh, "open")));
        openPrs.push(...olderOpen.flat().filter((pr) => !pr.isCrossRepository));
      }
    }
    const missing = [...new Set(branches)].filter((branch) => ![...prs, ...openPrs].some((pr) => pr.headRefName === branch));
    for (let start = 0; start < missing.length; start += 4) {
      const older = await Promise.all(missing.slice(start, start + 4).map((branch) =>
        readMergedPrs(repo, branch, fresh)));
      prs.push(...older.flat());
    }
    return { openPrs, prs: prs.filter((pr): pr is MergedPr => !pr.isCrossRepository && /^[a-f0-9]{40,64}$/.test(pr.headRefOid) && Boolean(pr.mergedAt)) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return { prs: [], error: /rate limit/i.test(message)
      ? "GitHub rate limit reached. Wait a few minutes, then refresh."
      : "Could not verify GitHub merges. Check GitHub CLI access and refresh." };
  }
}

/** Share fresh PR and default-branch evidence across a cleanup batch. */
export async function loadMergedWorktreePrs(repoRoot: string, branches: string[] = [], fresh = false): Promise<MergedWorktreePrs> {
  const [prs, branch] = await Promise.all([loadPrEvidence(repoRoot, branches, fresh), loadDefaultBranch(repoRoot, fresh)]);
  return { ...prs, ...branch };
}

export async function verifyWorktreeMerge(tree: WorktreeInfo, lookup: MergedWorktreePrs): Promise<WorktreeMerge> {
  if (lookup.error) return { verified: false, reason: lookup.error };
  const open = lookup.openPrs?.find((pr) => pr.headRefName === tree.branch || pr.headRefOid === tree.head || pr.url === tree.pr?.url);
  if (open) return { verified: false, reason: `PR #${open.number} is still open`, openPr: { number: open.number, url: open.url } };
  const candidates = lookup.prs.filter((pr) =>
    pr.headRefOid === tree.head || pr.headRefName === tree.branch || pr.url === tree.pr?.url);
  for (const pr of candidates) {
    // Squash merges change commit IDs on main. The PR's original head proves
    // this checkout was included; matching a branch name alone proves nothing.
    const included = tree.head === pr.headRefOid || (await runGitRepoAsync(tree.path,
      ["merge-base", "--is-ancestor", tree.head, pr.headRefOid])).status === 0;
    if (included) return {
      verified: true, reason: `PR #${pr.number} merged; checkout commits verified`,
      pr: { number: pr.number, url: pr.url, head: pr.headRefOid, mergedAt: pr.mergedAt },
    };
  }
  if (lookup.defaultBranch && await isWorktreeIntegrated(tree.path, tree.head, lookup.defaultBranch)) {
    return { verified: true, reason: `Changes already included in ${lookup.defaultBranch.name}; no rebase needed` };
  }
  return { verified: false, reason: lookup.error || lookup.defaultBranchError || (candidates.length
    ? "Merged PR found, but this checkout has commits not verified in it"
    : "Checkout changes not verified as merged") };
}
