/**
 * Capability Radar — local filesystem scanner.
 *
 * Walks a cloned repo, building the {@link ScanFile} list the detector engine
 * consumes. Reuses the same guardrails as repo-context (ignore heavy dirs, never
 * read secret files, cap file count) and reads a bounded set of content-probe
 * candidates so concept detection works without unbounded I/O.
 */

import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createCliLimiter } from "@/lib/ai/cli-limit";
import { enrichSignalsWithAi } from "./ai-enrich";
import { detectSignals, isContentCandidate, type ScanFile } from "./detectors";
import { resolveAuthorEmails, lastTouchedByMe } from "./exposure";
import { readRepoScanCache, repoUnchanged } from "./snapshots";
import type { RepoScan } from "./types";

const execFileAsync = promisify(execFile);

const IGNORE_DIRS = new Set([
  ".git", ".next", ".turbo", ".venv", "build", "coverage", "dist",
  "node_modules", "out", "target", "vendor", ".terraform",
]);
const SECRET_FILE_RE = /(^|[/\\])(\.env|\.npmrc|\.pypirc|id_rsa|id_ed25519|.*secret.*|.*token.*|.*credential.*)$/i;

const MAX_FILES = 6_000;
const MAX_CONTENT_FILES = 400;
const MAX_CONTENT_BYTES = 64 * 1024;

interface WalkedFile {
  path: string;
  ext: string;
  base: string;
  absolute: string;
}

/**
 * Cap concurrent filesystem handles. A scan can touch thousands of files across
 * every clone at once; without a ceiling that exhausts file descriptors (EMFILE)
 * on a default macOS ulimit.
 */
const fileLimiter = createCliLimiter(64);

async function walk(repoPath: string): Promise<WalkedFile[]> {
  const out: WalkedFile[] = [];
  const queue = [repoPath];
  while (queue.length > 0 && out.length < MAX_FILES) {
    const dir = queue.shift()!;
    let entries: Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (out.length >= MAX_FILES) break;
      const absolute = path.join(dir, entry.name);
      const rel = path.relative(repoPath, absolute).split(path.sep).join("/");
      if (SECRET_FILE_RE.test(rel)) continue;
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) queue.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const base = entry.name.toLowerCase();
      const dot = base.lastIndexOf(".");
      const ext = dot > 0 ? base.slice(dot) : "";
      out.push({ path: rel, ext, base, absolute });
    }
  }
  return out;
}

/**
 * Attach content for the probe candidates. Stats run first so the content budget
 * still applies to walk order over files that pass the size check — the same
 * selection the previous synchronous version made, without blocking the loop.
 */
async function toScanFiles(walked: WalkedFile[]): Promise<ScanFile[]> {
  const probes = walked.filter((f) => isContentCandidate(f.ext));
  const sized = await Promise.all(
    probes.map((f) =>
      fileLimiter.run(async () => {
        try {
          const stat = await fsp.stat(f.absolute);
          return stat.size <= MAX_CONTENT_BYTES ? f : null;
        } catch {
          return null;
        }
      }),
    ),
  );

  const readable = sized
    .filter((f): f is WalkedFile => f !== null)
    .slice(0, MAX_CONTENT_FILES);

  const contents = new Map<string, string>();
  await Promise.all(
    readable.map((f) =>
      fileLimiter.run(async () => {
        try {
          contents.set(f.absolute, await fsp.readFile(f.absolute, "utf-8"));
        } catch {
          // unreadable — filename rules still apply
        }
      }),
    ),
  );

  return walked.map((f) => ({
    path: f.path,
    ext: f.ext,
    base: f.base,
    content: contents.get(f.absolute),
  }));
}

async function headSha(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoPath, "rev-parse", "HEAD"], { timeout: 5_000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Full local scan of a cloned repo, including personal exposure per signal.
 * Reuses the cached scan when HEAD hasn't moved, skipping both the filesystem
 * walk and the AI enrichment call.
 */
export async function scanLocalRepo(repoPath: string): Promise<RepoScan> {
  const repoName = path.basename(repoPath);
  const sha = await headSha(repoPath);

  // Unchanged since last scan → reuse. The source check guards against a repo
  // that was probed remotely under the same repoName before it was cloned.
  if (repoUnchanged(repoName, sha)) {
    const cached = readRepoScanCache(repoName);
    if (cached?.scan.source === "local") {
      return { ...cached.scan, depth: "cached", scannedAt: new Date().toISOString() };
    }
  }

  const walked = await walk(repoPath);
  const files = await toScanFiles(walked);
  const signals = await enrichSignalsWithAi(files, detectSignals(files));

  const emails = await resolveAuthorEmails(repoPath);
  const lastTouched: Record<string, string | null> = {};
  await Promise.all(
    signals.map(async (sig) => {
      lastTouched[sig.id] = await lastTouchedByMe(repoPath, sig.evidence, emails);
    }),
  );

  return {
    repoName,
    repoRef: repoPath,
    source: "local",
    sha,
    depth: "full",
    scannedAt: new Date().toISOString(),
    signals,
    lastTouchedByMe: lastTouched,
  };
}
