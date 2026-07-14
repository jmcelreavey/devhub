/**
 * Capability Radar — local filesystem scanner.
 *
 * Walks a cloned repo, building the {@link ScanFile} list the detector engine
 * consumes. Reuses the same guardrails as repo-context (ignore heavy dirs, never
 * read secret files, cap file count) and reads a bounded set of content-probe
 * candidates so concept detection works without unbounded I/O.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { enrichSignalsWithAi } from "./ai-enrich";
import { detectSignals, isContentCandidate, type ScanFile } from "./detectors";
import { resolveAuthorEmails, lastTouchedByMe } from "./exposure";
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

function walk(repoPath: string): WalkedFile[] {
  const out: WalkedFile[] = [];
  const queue = [repoPath];
  while (queue.length > 0 && out.length < MAX_FILES) {
    const dir = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
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

function toScanFiles(walked: WalkedFile[]): ScanFile[] {
  let budget = MAX_CONTENT_FILES;
  return walked.map((f) => {
    let content: string | undefined;
    if (budget > 0 && isContentCandidate(f.ext)) {
      try {
        const stat = fs.statSync(f.absolute);
        if (stat.size <= MAX_CONTENT_BYTES) {
          content = fs.readFileSync(f.absolute, "utf-8");
          budget -= 1;
        }
      } catch {
        // unreadable — filename rules still apply
      }
    }
    return { path: f.path, ext: f.ext, base: f.base, content };
  });
}

async function headSha(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoPath, "rev-parse", "HEAD"], { timeout: 5_000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Full local scan of a cloned repo, including personal exposure per signal. */
export async function scanLocalRepo(repoPath: string): Promise<RepoScan> {
  const repoName = path.basename(repoPath);
  const walked = walk(repoPath);
  const files = toScanFiles(walked);
  const signals = await enrichSignalsWithAi(files, detectSignals(files));
  const sha = await headSha(repoPath);

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
