import { NextResponse } from "next/server";
import { detectGitConflicts } from "@/lib/git-conflicts";
import { getRepoRoot } from "@/lib/notes-dir";
import { runGitRepo, runGitRepoAsync } from "@/lib/git-repo-local";

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

    const dirtyLines = status.stdout.trim().split("\n").filter(Boolean);
    const dirtyCount = dirtyLines.length;
    let notesCount = 0;
    let tasksCount = 0;
    let diagramsCount = 0;
    let docsCount = 0;
    for (const line of dirtyLines) {
      const fp = line.slice(3);
      if (fp.startsWith("notes/") || fp.startsWith("collections/")) notesCount++;
      else if (fp.startsWith("tasks/")) tasksCount++;
      else if (fp.startsWith("diagrams/")) diagramsCount++;
      else if (fp.startsWith("docs/")) docsCount++;
    }

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
    if (dirtyCount > 0) {
      hints.push({
        severity: "warn",
        text: "Working tree is dirty — pull / collect / commit / push are skipped until it is clean.",
        fix: "Use Commit & sync on this page, the warning (triangle + count) button in the top bar, or Actions → Commit & Push Dirty Files. Then run Update & Sync.",
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
      dirtyCount,
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
