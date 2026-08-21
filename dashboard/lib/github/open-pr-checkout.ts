import { execGh } from "@/lib/gh-exec";
import { detectUnmergedFiles } from "@/lib/git/conflicts";
import { looksLikeIndexLockError, prepareGitIndexWrite } from "@/lib/git/index-lock";
import { runGitRepoAsync } from "@/lib/git/repo-local";
import { parseOwnerRepo } from "@/lib/github/repo-name";
import { findScannedRepoByGithubFullName } from "@/lib/scanned-repo";

export class OpenPrCheckoutError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "OpenPrCheckoutError";
  }
}

export interface PrCheckoutResult {
  localRepoName: string;
  repoPath: string;
  branch: string;
  stashed: boolean;
  alreadyOnBranch: boolean;
}

interface PrViewJson {
  headRefName?: string;
}

export async function checkoutPullRequestBranch(opts: {
  repo: string;
  number: number;
}): Promise<PrCheckoutResult> {
  const parsed = parseOwnerRepo(opts.repo);
  if (!parsed) {
    throw new OpenPrCheckoutError("Expected owner/name", 400);
  }
  const local = findScannedRepoByGithubFullName(opts.repo);
  if (!local) {
    throw new OpenPrCheckoutError(
      `No local clone of ${opts.repo}. Clone it under your repos folder first.`,
      404,
    );
  }

  const headRef = await fetchPrHeadRef(opts.repo, opts.number);
  const current = await currentBranchName(local.path);
  if (headRef && current && current === headRef) {
    return {
      localRepoName: local.name,
      repoPath: local.path,
      branch: current,
      stashed: false,
      alreadyOnBranch: true,
    };
  }

  const unmerged = detectUnmergedFiles(local.path);
  if (unmerged.length > 0) {
    throw new OpenPrCheckoutError(
      `Cannot switch branches: ${unmerged.length} unmerged path${unmerged.length === 1 ? "" : "s"}. Resolve conflicts first.`,
      409,
    );
  }

  const status = await runGitRepoAsync(local.path, ["status", "--porcelain"]);
  const dirty = (status.stdout || "").trim().length > 0;
  let stashed = false;
  const targetLabel = headRef || `PR #${opts.number}`;

  if (dirty) {
    const prep = prepareGitIndexWrite(local.path);
    if (!prep.ok) {
      throw new OpenPrCheckoutError(prep.error || "Git index is locked", 409);
    }
    const stash = await runGitRepoAsync(local.path, [
      "stash",
      "push",
      "--include-untracked",
      "-m",
      `DevHub auto-stash before opening ${opts.repo}#${opts.number} (${targetLabel})`,
    ]);
    if (stash.status !== 0) {
      const gitError = stash.stderr.trim() || stash.stdout.trim() || "Stash failed";
      if (looksLikeIndexLockError(stash.stderr, stash.stdout)) {
        throw new OpenPrCheckoutError(gitError, 409);
      }
      throw new OpenPrCheckoutError(gitError, 500);
    }
    stashed = true;
  }

  try {
    await execGh(["pr", "checkout", String(opts.number), "--repo", opts.repo], {
      cwd: local.path,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Couldn't check out the PR branch";
    const hint = stashed
      ? ` Local changes are in the stash (search for ${opts.repo}#${opts.number}).`
      : "";
    throw new OpenPrCheckoutError(`${message}.${hint}`, 500);
  }

  const branch = (await currentBranchName(local.path)) || headRef || `pr-${opts.number}`;
  return {
    localRepoName: local.name,
    repoPath: local.path,
    branch,
    stashed,
    alreadyOnBranch: false,
  };
}

async function fetchPrHeadRef(repo: string, number: number): Promise<string | null> {
  try {
    const { stdout } = await execGh([
      "pr",
      "view",
      String(number),
      "--repo",
      repo,
      "--json",
      "headRefName",
    ]);
    const parsed = JSON.parse(stdout) as PrViewJson;
    const name = parsed.headRefName?.trim();
    return name || null;
  } catch {
    return null;
  }
}

async function currentBranchName(repoPath: string): Promise<string | null> {
  const result = await runGitRepoAsync(repoPath, ["branch", "--show-current"]);
  if (result.status !== 0) return null;
  const name = result.stdout.trim();
  return name || null;
}
