import path from "node:path";
import { NextResponse } from "next/server";
import { detectGitConflicts } from "@/lib/git-conflicts";
import {
  getRepoRoot,
  getNotesDir,
  getCollectionsDir,
  getTasksDir,
  getDocsDir,
  getUpstartsDir,
} from "@/lib/notes-dir";
import { runGitRepo, runGitRepoAsync } from "@/lib/git-repo-local";
import { DIAGRAMS_DIR } from "@/lib/diagram-utils";
import { isGitNoisePath } from "@/lib/repo-git-parsers";

type ContentBucket = "notes" | "tasks" | "docs";

/** Repo-relative POSIX prefix (trailing slash) for a content dir, or null when it lives outside the repo. */
function repoRelativePrefix(root: string, dir: string): string | null {
  const rel = path.relative(root, dir);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return `${rel.split(path.sep).join("/")}/`;
}

function safeContentDir(resolve: () => string): string | null {
  try {
    return resolve();
  } catch {
    return null;
  }
}

/**
 * Classify dirty files by their CONFIGURED content directory rather than
 * hardcoded path literals. This keeps tasks/notes/docs counted as syncable
 * "content" (not generic "dirty files") even when TASKS_DIR/NOTES_DIR are
 * relocated — a supported setup per the personal-data boundary in CONTRIBUTING.
 */
function buildContentBuckets(root: string): { bucket: ContentBucket; prefix: string }[] {
  const buckets: { bucket: ContentBucket; prefix: string }[] = [];
  const add = (bucket: ContentBucket, dir: string | null, fallback: string): void => {
    const prefix = dir ? repoRelativePrefix(root, dir) : `${fallback}/`;
    if (prefix) buckets.push({ bucket, prefix });
  };
  add("notes", safeContentDir(getNotesDir), "notes");
  add("notes", safeContentDir(getCollectionsDir), "collections");
  add("tasks", safeContentDir(getTasksDir), "tasks");
  add("tasks", safeContentDir(getUpstartsDir), "upstarts");
  add("docs", safeContentDir(getDocsDir), "docs");
  return buckets;
}

/** Throttle the network fetch — local counting stays per-request. */
const FETCH_TTL_MS = 4 * 60 * 1000;
let lastUpstreamFetchAt = 0;

export async function GET() {
  const root = getRepoRoot();
  try {
    const branch = runGitRepo(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const status = runGitRepo(root, ["status", "--porcelain=v1"]);
    const log = runGitRepo(root, ["log", "-1", "--format=%H%n%at%n%s"]);

    if (branch.status !== 0 || status.status !== 0 || log.status !== 0) {
      return NextResponse.json({ error: "Unexpected git output" }, { status: 500 });
    }

    const dirtyLines = status.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      // Match Git workspace badges: .DS_Store / __pycache__ don't count as dirty.
      .filter((line) => {
        let fp = line.slice(3);
        if (fp.includes(" -> ")) fp = fp.split(" -> ").pop()!.trim();
        return !isGitNoisePath(fp);
      });
    const dirtyCount = dirtyLines.length;
    const contentBuckets = buildContentBuckets(root);
    const diagramsPrefix = `${DIAGRAMS_DIR}/`;
    let notesCount = 0;
    let tasksCount = 0;
    let diagramsCount = 0;
    let docsCount = 0;
    for (const line of dirtyLines) {
      let fp = line.slice(3);
      if (fp.includes(" -> ")) fp = fp.split(" -> ").pop()!.trim();
      if (fp.startsWith(diagramsPrefix)) {
        diagramsCount++;
        continue;
      }
      const hit = contentBuckets.find((b) => fp.startsWith(b.prefix));
      if (!hit) continue;
      if (hit.bucket === "notes") notesCount++;
      else if (hit.bucket === "tasks") tasksCount++;
      else docsCount++;
    }
    // Dirty files that are NOT syncable content (notes/tasks/diagrams/docs).
    // The top bar treats content as a one-click sync; everything else opens
    // the DevHub Git workspace (stage / diff / commit / conflicts).
    const otherDirtyCount = dirtyCount - (notesCount + tasksCount + diagramsCount + docsCount);

    // ahead/behind needs a network `git fetch`, but this endpoint is polled
    // every 30s by the top-bar indicator — fetching every call burned
    // 700–950ms per request and hammered the remote. Fetch at most every
    // FETCH_TTL; in between, recount against the last-fetched upstream ref
    // (local-only, fast) so ahead counts stay live as the user commits.
    let ahead = 0;
    let behind = 0;
    try {
      const now = Date.now();
      if (now - lastUpstreamFetchAt > FETCH_TTL_MS) {
        lastUpstreamFetchAt = now;
        await runGitRepoAsync(root, ["fetch", "--quiet", "--no-tags"], { timeout: 10_000 });
      }
      const countOut = runGitRepo(root, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]);
      if (countOut.status === 0) {
        const parts = countOut.stdout.trim().split(/\s+/);
        behind = parseInt(parts[0], 10) || 0;
        ahead = parseInt(parts[1], 10) || 0;
      }
    } catch {
      // No upstream, offline, or fetch unavailable. Keep this status endpoint best-effort.
    }

    const raw = log.stdout.trimEnd().replace(/\r\n/g, "\n");
    const nl1 = raw.indexOf("\n");
    const nl2 = nl1 >= 0 ? raw.indexOf("\n", nl1 + 1) : -1;
    if (nl1 < 0 || nl2 < 0) {
      return NextResponse.json({ error: "Unexpected git log output" }, { status: 500 });
    }
    const fullHash = raw.slice(0, nl1);
    const authoredAtRaw = raw.slice(nl1 + 1, nl2).trim();
    const authoredAt = Number.parseInt(authoredAtRaw, 10);
    const message = raw.slice(nl2 + 1).trimEnd();
    if (!Number.isFinite(authoredAt)) {
      return NextResponse.json({ error: "Unexpected git log timestamp" }, { status: 500 });
    }
    const branchName = branch.stdout.trim();

    const hints: { severity: "warn" | "error"; text: string; fix?: string }[] = [];
    if (branchName !== "main" && branchName !== "master") {
      hints.push({
        severity: "warn",
        text: `Update & Sync expects branch main or master (currently ${branchName}).`,
        fix: "git checkout main && git pull",
      });
    }
    const contentDirtyCount = notesCount + tasksCount + diagramsCount + docsCount;
    if (otherDirtyCount > 0) {
      hints.push({
        severity: "warn",
        text: "Working tree has dirty files — pull / collect / commit / push are skipped until it is clean.",
        fix: "Open Git from the top-bar warning button (or /repos → Open Git on this checkout), stage and commit, then run Update & Sync.",
      });
    } else if (contentDirtyCount > 0) {
      // Content (notes/tasks/diagrams/docs) is not a generic "dirty file" — it
      // has a dedicated one-tap sync. Surface it as content, not as dirt.
      hints.push({
        severity: "warn",
        text: "Notes, tasks, and diagrams have unsynced changes.",
        fix: "Click the cloud (content) button in the top bar to sync them, then run Update & Sync.",
      });
    }
    if (ahead > 0 && behind > 0) {
      hints.push({
        severity: "error",
        text: "Local and remote have diverged (ahead and behind). Update & Sync will refuse until resolved.",
        fix: "git fetch origin && git rebase origin/" + branchName + "  — resolve conflicts — then push.",
      });
    }

    const conflictFiles = detectGitConflicts(root);
    if (conflictFiles.length > 0) {
      hints.push({
        severity: "error",
        text: `${conflictFiles.length} merge conflict${conflictFiles.length !== 1 ? "s" : ""} need resolution before sync.`,
        fix: "Open Status → Merge conflicts to resolve in the dashboard, or fix markers manually.",
      });
    }

    return NextResponse.json({
      branch: branchName,
      repoName: path.basename(root),
      repoPath: root,
      dirtyCount,
      otherDirtyCount,
      contentDirtyCount,
      notesCount,
      tasksCount,
      diagramsCount,
      docsCount,
      ahead,
      behind,
      conflictCount: conflictFiles.length,
      conflictFiles: conflictFiles.map((c) => c.path),
      lastCommit: { hash: fullHash.slice(0, 7), authoredAt, message },
      hints,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
