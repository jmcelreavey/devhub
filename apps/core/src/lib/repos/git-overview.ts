import fs from "node:fs";
import path from "node:path";
import { execExternal } from "../exec-external";
import { parsePorcelainStatus, isUnmergedFile, isGitNoisePath } from "../../../../../packages/shared/ui-lib/repos/git-parsers";
import type { RepoGitOverviewPayload, RepoGitOverviewRepo } from "../../../../../packages/shared/repos/types";
import { getReposScanDir, listRepoNames } from "./index";
import { pMap } from "../p-limit";

const STATUS_TIMEOUT_MS = 8_000;
const OVERVIEW_TTL_MS = 60_000;
const OVERVIEW_CONCURRENCY = 8;

interface CachedOverview {
  at: number;
  payload: RepoGitOverviewPayload;
}

let cached: CachedOverview | null = null;

/**
 * Per-repo snapshots, so one pathological clone cannot make every scan pay for
 * it. A repo whose status timed out is retried on a much longer interval.
 */
interface RepoCacheEntry {
  at: number;
  repo: RepoGitOverviewRepo;
  ttl: number;
}
const repoCache = new Map<string, RepoCacheEntry>();
const SLOW_REPO_TTL_MS = 5 * 60_000;

/**
 * One `git status --branch` per repo is enough for the rail: it carries the
 * branch, the upstream and its ahead/behind, plus every changed path and its
 * unmerged state. The full /api/repos card scan runs three or more git
 * processes per repo and is not what this page needs.
 */
async function readOverviewRepo(name: string, repoPath: string): Promise<RepoGitOverviewRepo> {
  const fallback: RepoGitOverviewRepo = {
    name,
    path: repoPath,
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    dirtyCount: 0,
    conflictCount: 0,
    lastActivityMs: lastActivity(repoPath),
    error: true,
  };
  try {
    const { stdout } = await execExternal(
      "git",
      ["-C", repoPath, "status", "--porcelain=v1", "-z", "--branch"],
      { timeoutMs: STATUS_TIMEOUT_MS, label: "git:overview" },
    );
    const [header, ...entries] = stdout.split("\0");
    const tracking = parseBranchHeader(header ?? "");
    const files = parsePorcelainStatus(entries.join("\0")).filter((file) => !isGitNoisePath(file.path));
    return {
      name,
      path: repoPath,
      branch: tracking.branch,
      upstream: tracking.upstream,
      ahead: tracking.ahead,
      behind: tracking.behind,
      dirtyCount: files.length,
      conflictCount: files.filter(isUnmergedFile).length,
      lastActivityMs: lastActivity(repoPath),
    };
  } catch {
    return fallback;
  }
}

interface BranchHeader {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
}

/** `## main...origin/main [ahead 1, behind 2]`, `## HEAD (no branch)`, `## No commits yet on x`. */
export function parseBranchHeader(header: string): BranchHeader {
  const empty: BranchHeader = { branch: null, upstream: null, ahead: 0, behind: 0 };
  const match = /^##\s+(.+)$/.exec(header.trim());
  if (!match) return empty;
  const [, rest] = match;
  if (!rest) return empty;
  if (rest.startsWith("HEAD (no branch)")) return empty;
  const body = rest.replace(/^No commits yet on\s+/, "");
  const tracking = /^(.*?)(?:\.\.\.(\S+))?(?:\s+\[(.+)\])?$/.exec(body);
  if (!tracking) return empty;
  const branch = tracking[1] || null;
  const upstream = tracking[2] ?? null;
  const flags = tracking[3] ?? "";
  const ahead = Number(/ahead (\d+)/.exec(flags)?.[1] ?? 0);
  const behind = Number(/behind (\d+)/.exec(flags)?.[1] ?? 0);
  return { branch, upstream, ahead, behind };
}

function lastActivity(repoPath: string): number {
  // The reflog's mtime is the cheapest honest "last touched" signal: it moves
  // on commit, checkout and pull but not on a plain edit.
  const candidates = [".git/logs/HEAD", ".git/HEAD", ".git"];
  let newest = 0;
  for (const relative of candidates) {
    try {
      const stat = fs.statSync(path.join(repoPath, relative));
      newest = Math.max(newest, Math.round(stat.mtimeMs));
    } catch {
      // missing candidate — try the next
    }
  }
  return newest;
}

function attentionScore(repo: RepoGitOverviewRepo): number {
  const conflicts = repo.conflictCount > 0 ? 1000 : 0;
  const dirty = repo.dirtyCount > 0 ? 100 : 0;
  const behind = repo.behind > 0 ? 10 : 0;
  const ahead = repo.ahead > 0 ? 1 : 0;
  return conflicts + dirty + behind + ahead;
}

export async function readGitOverview(options: { refresh?: boolean } = {}): Promise<RepoGitOverviewPayload> {
  const now = Date.now();
  if (!options.refresh && cached && now - cached.at < OVERVIEW_TTL_MS) return cached.payload;
  const scanDir = getReposScanDir();
  const names = listRepoNames();
  for (const key of repoCache.keys()) {
    if (!names.some((name) => path.join(scanDir, name) === key)) repoCache.delete(key);
  }
  const repos = await pMap(names, OVERVIEW_CONCURRENCY, async (name) => {
    const repoPath = path.join(scanDir, name);
    const entry = repoCache.get(repoPath);
    if (!options.refresh && entry && now - entry.at < entry.ttl) return entry.repo;
    const repo = await readOverviewRepo(name, repoPath);
    repoCache.set(repoPath, {
      at: now,
      repo,
      ttl: repo.error ? SLOW_REPO_TTL_MS : OVERVIEW_TTL_MS,
    });
    return repo;
  });
  repos.sort((a, b) => attentionScore(b) - attentionScore(a) || b.lastActivityMs - a.lastActivityMs || a.name.localeCompare(b.name));
  const payload: RepoGitOverviewPayload = { scanDir, repos, scannedAt: new Date().toISOString() };
  cached = { at: now, payload };
  return payload;
}
