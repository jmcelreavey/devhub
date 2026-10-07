import { runGitRepoAsync } from "@/lib/git/repo-local";
import { ttlCached, type TtlPromiseEntry } from "@/lib/ttl-cache";

export interface DefaultBranchEvidence { name: string; head: string; tree: string }
interface DefaultBranchLookup { defaultBranch?: DefaultBranchEvidence; defaultBranchError?: string }
const previewCache = new Map<string, TtlPromiseEntry<DefaultBranchLookup>>();
const oid = /^[a-f0-9]{40,64}$/;

async function readDefaultBranch(repoRoot: string): Promise<DefaultBranchLookup> {
  const unavailable = { defaultBranchError: "Could not verify the current default branch. Fetch and refresh." };
  // Do not trust a stale origin/main or change any checkout, branch or FETCH_HEAD.
  const remote = await runGitRepoAsync(repoRoot, ["ls-remote", "--symref", "origin", "HEAD"],
    { timeout: 15_000, useGhCredentials: true });
  if (remote.status !== 0) return unavailable;
  const name = remote.stdout.match(/^ref: refs\/heads\/(.+)\tHEAD$/m)?.[1];
  const head = remote.stdout.match(/^([a-f0-9]{40,64})\tHEAD$/m)?.[1];
  if (!name || !head) return unavailable;
  const exists = await runGitRepoAsync(repoRoot, ["cat-file", "-e", `${head}^{commit}`], { timeout: 5_000 });
  if (exists.status !== 0) {
    const fetched = await runGitRepoAsync(repoRoot, ["fetch", "--no-tags", "--no-write-fetch-head", "origin", head],
      { timeout: 45_000, useGhCredentials: true });
    if (fetched.status !== 0) return unavailable;
  }
  const tree = await runGitRepoAsync(repoRoot, ["rev-parse", `${head}^{tree}`], { timeout: 5_000 });
  if (tree.status !== 0 || !oid.test(tree.stdout.trim())) return unavailable;
  return { defaultBranch: { name, head, tree: tree.stdout.trim() } };
}

export function loadDefaultBranch(repoRoot: string, fresh: boolean): Promise<DefaultBranchLookup> {
  return fresh ? readDefaultBranch(repoRoot) : ttlCached(previewCache, repoRoot, 60_000, () => readDefaultBranch(repoRoot));
}

/** A conflict-free merge that adds nothing proves the committed changes are integrated. */
export async function isWorktreeIntegrated(repoRoot: string, head: string, base: DefaultBranchEvidence): Promise<boolean> {
  if (![head, base.head, base.tree].every((value) => oid.test(value))) return false;
  // Custom merge drivers can silently discard changes, so they cannot prove inclusion.
  const drivers = await runGitRepoAsync(repoRoot, ["config", "--get-regexp", "^merge\\..*\\.driver$"], { timeout: 5_000 });
  if (drivers.status !== 1 || drivers.stderr.trim()) return false;
  const merged = await runGitRepoAsync(repoRoot,
    ["-c", "merge.renormalize=false", "-c", "merge.default=text", "merge-tree", "--write-tree", "--no-messages", base.head, head],
    { timeout: 15_000 });
  return merged.status === 0 && merged.stdout.trim() === base.tree;
}
