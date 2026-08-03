import { NextResponse, type NextRequest } from "next/server";
import {
  buildCouplingIndex,
  suggestCompanions,
  type CouplingIndex,
  type CouplingSuggestion,
} from "@/lib/git/change-coupling";
import { isSafeRepoRelPath } from "@/lib/git/ref-safety";
import { runGitRepoAsync } from "@/lib/git/repo-local";
import { withScannedRepo, type RepoParams } from "../_shared";

export const dynamic = "force-dynamic";

/** History window. Far enough back to be evidence, near enough to be current. */
const COMMIT_LIMIT = 800;
/** Rebuilding costs a `git log` over 800 commits — worth holding briefly. */
const CACHE_TTL_MS = 5 * 60 * 1000;

const cache = new Map<string, { index: CouplingIndex; built: number }>();

/**
 * `git log --name-only` grouped into per-commit file sets.
 * NUL-prefixed hashes make the boundaries unambiguous when paths contain spaces.
 */
async function loadIndex(repoRoot: string, repoName: string): Promise<CouplingIndex | null> {
  const hit = cache.get(repoName);
  if (hit && Date.now() - hit.built < CACHE_TTL_MS) return hit.index;

  const log = await runGitRepoAsync(
    repoRoot,
    ["log", `--max-count=${COMMIT_LIMIT}`, "--name-only", "--no-merges", "--pretty=format:%x00%H"],
    { timeout: 30_000 },
  );
  if (log.status !== 0) return null;

  const commits: { files: string[] }[] = [];
  let current: string[] | null = null;
  for (const line of (log.stdout || "").split("\n")) {
    if (line.startsWith("\0")) {
      if (current) commits.push({ files: current });
      current = [];
      continue;
    }
    const path = line.trim();
    if (path && current) current.push(path);
  }
  if (current) commits.push({ files: current });

  const index = buildCouplingIndex(commits);
  cache.set(repoName, { index, built: Date.now() });
  return index;
}

export interface CouplingPayload {
  suggestions: CouplingSuggestion[];
  commitsAnalysed: number;
}

/**
 * "You usually also change X."
 *
 * Merge commits are excluded — they restate their parents' files and would
 * inflate every pair they contain.
 */
export async function GET(req: NextRequest, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;

  const paths = (req.nextUrl.searchParams.get("paths") || "")
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean);
  if (paths.length === 0 || paths.some((p) => !isSafeRepoRelPath(p))) {
    return NextResponse.json({ suggestions: [], commitsAnalysed: 0 } satisfies CouplingPayload);
  }

  const index = await loadIndex(resolved.repoRoot, name);
  if (!index) {
    return NextResponse.json({ suggestions: [], commitsAnalysed: 0 } satisfies CouplingPayload);
  }

  return NextResponse.json(
    {
      suggestions: suggestCompanions(index, paths),
      commitsAnalysed: index.commitsAnalysed,
    } satisfies CouplingPayload,
    { headers: { "cache-control": "no-store" } },
  );
}
