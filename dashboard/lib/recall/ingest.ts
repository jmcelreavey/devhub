/**
 * Ingestion — filling the spine from signal DevHub already has.
 *
 * This is the part that makes the difference between a memory layer and a
 * memory *feature*. A retrieval system nobody feeds is a search box over an
 * empty directory; the existing `learnings/` tree is the cautionary example,
 * with 23 entries against 295 notes because writing one is a ten-step manual
 * workflow. Anything that depends on the user remembering to record something
 * will end up equally empty.
 *
 * So ingestion is pull-based and idempotent: every event gets a deterministic
 * id derived from its content, re-running is free, and the whole thing can be
 * driven from a scheduled job or a git hook without coordination.
 *
 * Git first because it is the highest-signal, lowest-cost source: commit
 * messages already contain the ticket keys, PR numbers and intent that the
 * graph needs, and reading them costs one subprocess.
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { getRepoRoot } from "@/lib/notes/dir";
import { parseCommitRefs } from "@/lib/git/commit-refs";
import type { EntityRef } from "@/lib/entity-note";
import { appendEvents, type AppendEventInput } from "./events";

const execFileAsync = promisify(execFile);

/** Commits per repo per run. A first run backfills, later runs no-op. */
const DEFAULT_COMMIT_LIMIT = 300;

/** Unit separator — cannot appear in a commit message, unlike `|` or `\t`. */
const FIELD = "\x1f";
const RECORD = "\x1e";

export interface IngestResult {
  source: string;
  scanned: number;
  written: number;
  skipped: number;
  error?: string;
}

/**
 * Deterministic event id.
 *
 * Idempotency is the whole contract here: `appendEvents` skips ids it has
 * already seen, so a stable hash is what lets this run on a cron without
 * writing the same commit every five minutes. Hashing the content rather than
 * using the SHA alone means an amended commit correctly registers as new.
 */
export function eventId(source: string, key: string): string {
  return createHash("sha1").update(`${source}:${key}`).digest("hex").slice(0, 24);
}

function isGitRepo(dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, ".git"));
  } catch {
    return false;
  }
}

interface ParsedCommit {
  sha: string;
  authorName: string;
  isoDate: string;
  subject: string;
  body: string;
}

export function parseGitLog(stdout: string): ParsedCommit[] {
  return stdout
    .split(RECORD)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, authorName, isoDate, subject, body] = record.split(FIELD);
      return {
        sha: (sha ?? "").trim(),
        authorName: (authorName ?? "").trim(),
        isoDate: (isoDate ?? "").trim(),
        subject: (subject ?? "").trim(),
        body: (body ?? "").trim(),
      };
    })
    .filter((commit) => commit.sha.length === 40 && commit.subject);
}

/** Read recent commits from one repo and turn them into event inputs. */
export async function commitEvents(
  repoRoot: string,
  options: { limit?: number; since?: string } = {},
): Promise<AppendEventInput[]> {
  const { limit = DEFAULT_COMMIT_LIMIT, since } = options;
  if (!isGitRepo(repoRoot)) return [];

  const repoName = path.basename(repoRoot);
  const format = ["%H", "%an", "%aI", "%s", "%b"].join(FIELD) + RECORD;

  const args = ["log", `--max-count=${limit}`, `--pretty=format:${format}`];
  if (since) args.push(`--since=${since}`);

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("git", args, {
      cwd: repoRoot,
      // A repo with a long history and large commit bodies can exceed the
      // default 1 MB buffer, and execFile's failure mode for that is a thrown
      // ENOBUFS with no partial output — silent data loss if uncaught.
      maxBuffer: 32 * 1024 * 1024,
      timeout: 30_000,
    }));
  } catch {
    return [];
  }

  return parseGitLog(stdout).map((commit) => {
    const message = `${commit.subject}\n\n${commit.body}`.trim();
    const { tickets, prNumbers } = parseCommitRefs(message);

    const refs: EntityRef[] = [
      { kind: "repo", id: repoName, label: repoName },
      ...tickets.map((key) => ({
        kind: "jira" as const,
        id: key,
        label: key,
        href: `/work?ticket=${key}`,
      })),
      ...prNumbers.map((n) => ({
        kind: "pr" as const,
        id: `${repoName}#${n}`,
        label: `${repoName}#${n}`,
      })),
    ];

    return {
      id: eventId("git", `${repoName}:${commit.sha}`),
      kind: "commit" as const,
      ts: commit.isoDate,
      title: commit.subject,
      body: commit.body || undefined,
      source: `git:${repoName}`,
      refs,
      meta: { repo: repoName, sha: commit.sha, author: commit.authorName },
    };
  });
}

export interface IngestOptions {
  /** Extra repo roots beyond the DevHub checkout. */
  repos?: string[];
  limit?: number;
  /** Git `--since` expression, e.g. `6.months` or an ISO date. */
  since?: string;
}

/**
 * Ingest commits from the DevHub checkout plus any repos passed in.
 *
 * Repos are supplied rather than discovered so this stays a pure-ish function
 * of its arguments — the API route owns the "which repos exist" question,
 * which needs the scan directory and the desktop runtime paths.
 */
export async function ingestGit(options: IngestOptions = {}): Promise<IngestResult[]> {
  const roots = [getRepoRoot(), ...(options.repos ?? [])];
  const seen = new Set<string>();
  const results: IngestResult[] = [];

  for (const root of roots) {
    const resolved = path.resolve(root);
    if (seen.has(resolved)) continue;
    seen.add(resolved);

    const source = `git:${path.basename(resolved)}`;
    if (!isGitRepo(resolved)) {
      results.push({ source, scanned: 0, written: 0, skipped: 0, error: "not a git repo" });
      continue;
    }

    try {
      const inputs = await commitEvents(resolved, { limit: options.limit, since: options.since });
      const written = appendEvents(inputs);
      results.push({
        source,
        scanned: inputs.length,
        written: written.length,
        skipped: inputs.length - written.length,
      });
    } catch (err) {
      results.push({
        source,
        scanned: 0,
        written: 0,
        skipped: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

