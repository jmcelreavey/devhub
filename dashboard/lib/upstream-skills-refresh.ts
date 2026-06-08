import fs from "node:fs";
import path from "node:path";
import {
  gitExtractSubtreeArchive,
  gitFetchOriginBranch,
  gitShortRef,
  readOriginRemoteUrl,
} from "./git-repo-local";
import {
  execGh,
  GH_AUTH_REQUIRED_MESSAGE,
  githubCliErrorInfo,
  isGithubCliAuthenticated,
} from "./gh-exec";
import { parseRepoFullNameFromRemote } from "./github-repo-url";
import {
  skillsCacheDir,
  skillsCacheExtractRoot,
  writeUpstreamSkillsManifest,
} from "./upstream-skills-cache";

export interface UpstreamSkillsRefreshResult {
  ok: boolean;
  warning?: string;
  commit?: string;
  branch?: string;
  repo?: string;
}

async function resolveUpstreamBranch(fullName: string, override?: string): Promise<string> {
  const fromEnv = override?.trim() || process.env.AI_TOOLS_BRANCH?.trim();
  if (fromEnv) return fromEnv;
  try {
    const { stdout } = await execGh([
      "repo",
      "view",
      fullName,
      "--json",
      "defaultBranch",
      "-q",
      ".defaultBranch",
    ]);
    const branch = stdout.trim();
    if (branch) return branch;
  } catch {
    // fall through
  }
  return "main";
}

function replaceDirContents(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Fetch upstream default branch and materialize `skills/` into DevHub's cache.
 * Does not modify the local checkout branch or working tree — safe with WIP/dirty trees.
 */
export async function refreshUpstreamSkills(opts: {
  checkoutRoot: string;
  branch?: string;
  dryRun?: boolean;
}): Promise<UpstreamSkillsRefreshResult> {
  if (opts.dryRun) return { ok: true };

  if (!(await isGithubCliAuthenticated())) {
    return { ok: false, warning: GH_AUTH_REQUIRED_MESSAGE };
  }

  const remoteUrl = readOriginRemoteUrl(opts.checkoutRoot);
  const fullName = parseRepoFullNameFromRemote(remoteUrl);
  if (!fullName) {
    return {
      ok: false,
      warning: `Could not resolve GitHub repo from origin remote (${remoteUrl ?? "missing"})`,
    };
  }

  const branch = await resolveUpstreamBranch(fullName, opts.branch);
  const remoteRef = `origin/${branch}`;

  try {
    await gitFetchOriginBranch(opts.checkoutRoot, branch);
  } catch (err) {
    return {
      ok: false,
      warning: githubCliErrorInfo(err, "git fetch failed").message,
      branch,
      repo: fullName,
    };
  }

  const commit = gitShortRef(opts.checkoutRoot, remoteRef);
  if (!commit) {
    return {
      ok: false,
      warning: `Fetched ${remoteRef} but could not resolve commit — is the branch present on origin?`,
      branch,
      repo: fullName,
    };
  }

  const extractRoot = skillsCacheExtractRoot(fullName, branch);
  const cachedSkillsDir = skillsCacheDir(fullName, branch);

  try {
    replaceDirContents(extractRoot);
    gitExtractSubtreeArchive(opts.checkoutRoot, remoteRef, "skills", extractRoot);
  } catch (err) {
    return {
      ok: false,
      warning: githubCliErrorInfo(err, "skills extract failed").message,
      commit,
      branch,
      repo: fullName,
    };
  }

  if (!fs.existsSync(cachedSkillsDir)) {
    return {
      ok: false,
      warning: `Upstream refresh completed but skills dir missing at ${cachedSkillsDir}`,
      commit,
      branch,
      repo: fullName,
    };
  }

  writeUpstreamSkillsManifest({
    checkoutRoot: path.resolve(opts.checkoutRoot),
    repo: fullName,
    branch,
    commit,
    skillsDir: cachedSkillsDir,
    updatedAt: new Date().toISOString(),
  });

  return { ok: true, commit, branch, repo: fullName };
}
