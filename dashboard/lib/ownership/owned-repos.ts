import fs from "node:fs";
import path from "node:path";
import { safeReadJSON, withMutex, writeAtomic } from "@/lib/atomic-write";
import { getRepoRoot } from "@/lib/notes/dir";
import {
  invalidateLocalRepoResolution,
  resolveLocalGithubRepos,
} from "@/lib/repos/resolution";
import { runGitRepoAsync } from "@/lib/git/repo-local";
import { execGh } from "@/lib/gh-exec";
import type { OwnedRepo, ResolvedOwnedRepo } from "./types";

interface OwnershipFile {
  version: 1;
  repos: OwnedRepo[];
}

interface FamiliarityFile {
  version: 1;
  learned: Record<string, string>;
}

const FULL_NAME_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function ownershipDir(): string {
  return path.join(getRepoRoot(), ".devhub", "ownership");
}

function ownershipPath(): string {
  return path.join(ownershipDir(), "repos.json");
}

function familiarityPath(fullName: string): string {
  return path.join(ownershipDir(), `${fullName.replace("/", "__")}.json`);
}

function defaultFile(): OwnershipFile {
  return { version: 1, repos: [] };
}

function canonicalFullName(fullName: string): string {
  const value = fullName.trim();
  if (!FULL_NAME_RE.test(value)) throw new Error("Invalid GitHub repo; expected owner/name");
  return value;
}

export function listOwnedRepos(): OwnedRepo[] {
  const file = safeReadJSON<OwnershipFile>(ownershipPath(), defaultFile());
  if (file.version !== 1 || !Array.isArray(file.repos)) return [];
  return file.repos
    .filter((repo) => FULL_NAME_RE.test(repo.fullName))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export function getOwnedRepo(fullName: string): OwnedRepo | null {
  const key = canonicalFullName(fullName).toLowerCase();
  return listOwnedRepos().find((repo) => repo.fullName.toLowerCase() === key) ?? null;
}

async function updateRepos(change: (repos: OwnedRepo[]) => OwnedRepo[]): Promise<OwnedRepo[]> {
  return withMutex(`ownership:${getRepoRoot()}`, async () => {
    const repos = change(listOwnedRepos());
    fs.mkdirSync(ownershipDir(), { recursive: true });
    await writeAtomic(ownershipPath(), JSON.stringify({ version: 1, repos } satisfies OwnershipFile, null, 2) + "\n");
    return repos;
  });
}

export async function addOwnedRepo(fullName: string): Promise<OwnedRepo> {
  const canonical = canonicalFullName(fullName);
  const key = canonical.toLowerCase();
  // The existence check has to happen inside the mutex: reading first and then
  // writing lets two concurrent adds of the same repo both see "absent" and
  // append duplicate entries.
  let result: OwnedRepo | null = null;
  await updateRepos((repos) => {
    const existing = repos.find((repo) => repo.fullName.toLowerCase() === key);
    if (existing) {
      result = existing;
      return repos;
    }
    result = {
      name: canonical.split("/")[1]!,
      fullName: canonical,
      addedAt: new Date().toISOString(),
      lastVisited: null,
      lastSeenSha: null,
      domains: null,
      teams: null,
    };
    return [...repos, result];
  });
  invalidateResolvedRepos();
  return result!;
}

export async function removeOwnedRepo(fullName: string): Promise<void> {
  const key = canonicalFullName(fullName).toLowerCase();
  await updateRepos((repos) => repos.filter((repo) => repo.fullName.toLowerCase() !== key));
  invalidateResolvedRepos();
}

export async function recordOwnedRepoVisit(fullName: string, headSha: string): Promise<void> {
  const key = canonicalFullName(fullName).toLowerCase();
  await updateRepos((repos) =>
    repos.map((repo) =>
      repo.fullName.toLowerCase() === key
        ? { ...repo, lastVisited: new Date().toISOString(), lastSeenSha: headSha || repo.lastSeenSha }
        : repo,
    ),
  );
  invalidateResolvedRepos();
}

export function readLearnedDomains(fullName: string): Record<string, string> {
  return safeReadJSON<FamiliarityFile>(familiarityPath(canonicalFullName(fullName)), {
    version: 1,
    learned: {},
  }).learned;
}

export async function recordLearnedDomain(fullName: string, domainId: string): Promise<void> {
  const filePath = familiarityPath(canonicalFullName(fullName));
  await withMutex(`ownership-familiarity:${fullName.toLowerCase()}`, async () => {
    const current = safeReadJSON<FamiliarityFile>(filePath, { version: 1, learned: {} });
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    await writeAtomic(
      filePath,
      JSON.stringify(
        { version: 1, learned: { ...current.learned, [domainId]: new Date().toISOString() } } satisfies FamiliarityFile,
        null,
        2,
      ) + "\n",
    );
  });
}

/**
 * Resolution is cached because it is not cheap and it is called a lot.
 *
 * `listRepos()` shells out to git twice per repo in the scan directory, and a
 * repo with no `origin/HEAD` costs an extra `gh repo view`. Before this cache,
 * loading the index re-resolved every owned repo once per brief, so the cost was
 * multiplied by the number of repos you own. Mutations invalidate it, so an
 * add/remove is still reflected immediately.
 */
const RESOLVE_TTL_MS = 60_000;
let resolvedCache: { expiresAt: number; value: Promise<ResolvedOwnedRepo[]> } | null = null;

export function invalidateResolvedRepos(): void {
  resolvedCache = null;
  invalidateLocalRepoResolution();
}

export function resolveOwnedRepos(): Promise<ResolvedOwnedRepo[]> {
  if (resolvedCache && resolvedCache.expiresAt > Date.now()) return resolvedCache.value;
  const value = resolveOwnedReposUncached().catch((error: unknown) => {
    resolvedCache = null;
    throw error;
  });
  resolvedCache = { expiresAt: Date.now() + RESOLVE_TTL_MS, value };
  return value;
}

async function resolveOwnedReposUncached(): Promise<ResolvedOwnedRepo[]> {
  const owned = listOwnedRepos();
  const locals = await resolveLocalGithubRepos();
  const localByFullName = new Map(
    locals.map(({ fullName, repo }) => [fullName.toLowerCase(), repo] as const),
  );
  return Promise.all(owned.map(async (repo) => {
    const key = repo.fullName.toLowerCase();
    const local = localByFullName.get(key);
    const remoteHead = local
      ? await runGitRepoAsync(local.path, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
      : null;
    let defaultBranch = remoteHead?.status === 0
      ? remoteHead.stdout.trim().replace(/^origin\//, "") || null
      : null;
    if (!defaultBranch) {
      try {
        const { stdout } = await execGh([
          "repo", "view", repo.fullName, "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name",
        ]);
        defaultBranch = stdout.trim() || null;
      } catch {
        // GitHub-only panels still work without default-branch metadata.
      }
    }
    return {
      ...repo,
      owner: repo.fullName.split("/")[0]!,
      localRepoName: local?.name ?? null,
      localPath: local?.path ?? null,
      url: `https://github.com/${repo.fullName}`,
      defaultBranch,
    };
  }));
}

export async function resolveOwnedRepo(fullName: string): Promise<ResolvedOwnedRepo | null> {
  const key = canonicalFullName(fullName).toLowerCase();
  return (await resolveOwnedRepos()).find((repo) => repo.fullName.toLowerCase() === key) ?? null;
}
