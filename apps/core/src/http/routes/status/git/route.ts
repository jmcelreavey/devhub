import { statusGit } from "../../../../../../../packages/shared/actions/status";
import path from "node:path";
import { detectGitConflictsAsync } from "../../../../lib/git/conflicts";
import { buildContentBuckets, matchContentBucket } from "../../../../lib/content/sync-dirs";
import { getCheckoutRoot } from "../../../../lib/desktop/runtime-paths";
import { gitEnv, runGitRepoAsync } from "../../../../lib/git/repo-local";
import { assessGitAvailability } from "../../../../lib/setup/git-availability";
import { isGitNoisePath, parsePorcelainStatus } from "../../../../../../../packages/shared/ui-lib/repos/git-parsers";
import { emitCoreEvent } from "@devhub/core/events/core-events";

/** Throttle the network fetch — local counting stays per-request. */
const FETCH_TTL_MS = 4 * 60 * 1000;
let lastUpstreamFetchAt = 0;
let lastUpstreamFetchRoot: string | null = null;
let lastUpstreamFetchSucceeded = false;

async function refreshUpstream(root: string): Promise<boolean> {
  const now = Date.now();
  if (lastUpstreamFetchRoot === root && now - lastUpstreamFetchAt <= FETCH_TTL_MS) return lastUpstreamFetchSucceeded;
  lastUpstreamFetchAt = now;
  lastUpstreamFetchRoot = root;
  lastUpstreamFetchSucceeded = false;
  const result = await runGitRepoAsync(root, ["fetch", "--quiet", "--no-tags"], { timeout: 10_000 });
  const succeeded = result.status === 0;
  if (lastUpstreamFetchRoot === root) lastUpstreamFetchSucceeded = succeeded;
  if (succeeded) emitCoreEvent("git");
  return succeeded;
}

export async function GET(request: Request) {
  const input = statusGit.input.parse({ scope: new URL(request.url).searchParams.get("scope") ?? undefined });
  return statusGit.handler(input, { read: () => readGitStatus(request) }) as Promise<Response>;
}

async function readGitStatus(request: Request) {
  const root = getCheckoutRoot();
  if (!root) {
    return Response.json({ available: false, reason: "no-checkout" });
  }
  const gate = await assessGitAvailability({ env: gitEnv(), augment: false });
  if (!gate.runnable) {
    return Response.json({ available: false, reason: "git-missing" });
  }
  const scope = new URL(request.url).searchParams.get("scope");
  if (scope === "external") {
    try {
      return Response.json({ ok: await refreshUpstream(root) });
    } catch {
      return Response.json({ ok: false });
    }
  }
  try {
    const branch = await runGitRepoAsync(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const status = await runGitRepoAsync(root, ["status", "--porcelain=v1"], { env: { GIT_OPTIONAL_LOCKS: "0" } });
    const log = await runGitRepoAsync(root, ["log", "-1", "--format=%H%n%at%n%s"]);

    if (branch.status !== 0 || status.status !== 0 || log.status !== 0) {
      return Response.json({ error: "Unexpected git output" }, { status: 500 });
    }

    // Parse raw stdout: trimming it first would eat the leading space of the
    // first porcelain line and shift that row's path by one character.
    // Match Git workspace badges: .DS_Store / __pycache__ don't count as dirty.
    const dirtyFiles = parsePorcelainStatus(status.stdout).filter((f) => !isGitNoisePath(f.path));
    const dirtyCount = dirtyFiles.length;
    const contentBuckets = buildContentBuckets(root);
    let notesCount = 0;
    let tasksCount = 0;
    let diagramsCount = 0;
    let docsCount = 0;
    for (const file of dirtyFiles) {
      const bucket = matchContentBucket(contentBuckets, file.path);
      if (bucket === "diagrams") diagramsCount++;
      else if (bucket === "notes") notesCount++;
      else if (bucket === "tasks") tasksCount++;
      else if (bucket === "docs") docsCount++;
    }
    // Dirty files that are NOT syncable content (notes/tasks/diagrams/docs).
    // The top bar treats content as a one-click sync; everything else opens
    // the DevHub Git workspace (stage / diff / commit / conflicts).
    const otherDirtyCount = dirtyCount - (notesCount + tasksCount + diagramsCount + docsCount);

    let ahead = 0;
    let behind = 0;
    try {
      if (scope !== "local") await refreshUpstream(root);
      const countOut = await runGitRepoAsync(root, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]);
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
      return Response.json({ error: "Unexpected git log output" }, { status: 500 });
    }
    const fullHash = raw.slice(0, nl1);
    const authoredAtRaw = raw.slice(nl1 + 1, nl2).trim();
    const authoredAt = Number.parseInt(authoredAtRaw, 10);
    const message = raw.slice(nl2 + 1).trimEnd();
    if (!Number.isFinite(authoredAt)) {
      return Response.json({ error: "Unexpected git log timestamp" }, { status: 500 });
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

    const conflictFiles = await detectGitConflictsAsync(root);
    if (conflictFiles.length > 0) {
      hints.push({
        severity: "error",
        text: `${conflictFiles.length} merge conflict${conflictFiles.length !== 1 ? "s" : ""} need resolution before sync.`,
        fix: "Open Status → Merge conflicts to resolve in the dashboard, or fix markers manually.",
      });
    }

    return Response.json({
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
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
