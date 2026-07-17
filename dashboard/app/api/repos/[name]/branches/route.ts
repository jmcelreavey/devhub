import { NextResponse, type NextRequest } from "next/server";
import { runGitRepo, runGitRepoAsync } from "@/lib/git-repo-local";
import { detectUnmergedFiles } from "@/lib/git-conflicts";
import {
  formatIndexLockError,
  looksLikeIndexLockError,
  prepareGitIndexWrite,
} from "@/lib/git-index-lock";
import { detectGitHookFailure, type GitHookPhase } from "@/lib/git-hook-failure";
import { withPersistedLog } from "@/lib/git-hook-failure-persist";
import { resolveScannedRepo } from "@/lib/scanned-repo";
import type { StashConflictPayload } from "@/app/repos/types";
import { parseChangedFiles, parseLeftRightCount, parseUnpushedCommits } from "./parsers";

function indexLockResponse(repoRoot: string, gitError?: string): NextResponse {
  return NextResponse.json(
    { error: formatIndexLockError(repoRoot, gitError), code: "index_lock" as const },
    { status: 409 },
  );
}

type Params = { params: Promise<{ name: string }> };

function looksLikeStashConflict(stderr: string, stdout: string): boolean {
  const text = `${stderr}\n${stdout}`;
  return /conflict/i.test(text) || /unmerged paths/i.test(text);
}

function stashConflictResponse(
  action: StashConflictPayload["action"],
  repoRoot: string,
  gitError: string,
  extras: { branch?: string; switched: boolean },
): NextResponse {
  const conflictFiles = detectUnmergedFiles(repoRoot).map((f) => f.path);
  const payload: StashConflictPayload = {
    code: "stash_conflict",
    action,
    branch: extras.branch,
    switched: extras.switched,
    conflictFiles,
    error: gitError || "Stash apply left conflicts",
  };
  return NextResponse.json(payload, { status: 409 });
}

async function resolveUpstream(repoRoot: string): Promise<string | null> {
  const upstream = await runGitRepoAsync(repoRoot, [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{u}",
  ]);
  const ref = upstream.stdout.trim();
  return upstream.status === 0 && ref ? ref : null;
}

function unpushedLogArgs(upstream: string | null): string[] {
  return upstream ? [`${upstream}..HEAD`] : ["HEAD", "--not", "--remotes"];
}

function hookFailureResponse(
  repoRoot: string,
  stdout: string,
  stderr: string,
  phase: GitHookPhase,
): NextResponse | null {
  const detected = detectGitHookFailure(stdout, stderr, phase);
  if (!detected) return null;
  const payload = withPersistedLog(repoRoot, detected);
  return NextResponse.json(
    {
      ...payload,
      error: payload.summary ?? `${payload.hook ?? "Git hook"} failed`,
    },
    { status: 422 },
  );
}

function pullFailureMessage(stderr: string, stdout: string): string {
  const text = `${stderr}\n${stdout}`.trim();
  if (/no tracking information|no upstream/i.test(text)) {
    return "No upstream branch — set upstream or push with -u first.";
  }
  if (/not possible to fast-forward|diverged/i.test(text)) {
    return "Branch has diverged from upstream — fetch, then merge or rebase (fast-forward pull won't work).";
  }
  if (/your local changes|would be overwritten/i.test(text)) {
    return "Local changes would be overwritten by pull — stash or commit first.";
  }
  return text || "Pull failed";
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { name } = await params;
  const rp = resolveScannedRepo(name);
  if (!rp) {
    return NextResponse.json({ error: "Unknown repo" }, { status: 404 });
  }

  const [branchResult, stashResult, statusResult, upstream] = await Promise.all([
    runGitRepoAsync(rp, ["branch", "--list", "--format=%(refname:short)"]),
    runGitRepoAsync(rp, ["stash", "list"]),
    runGitRepoAsync(rp, ["status", "--porcelain"]),
    resolveUpstream(rp),
  ]);
  const [unpushedResult, aheadBehindResult] = await Promise.all([
    runGitRepoAsync(rp, [
      "log",
      ...unpushedLogArgs(upstream),
      "--format=%x1e%H%x00%h%x00%s",
      "--name-only",
    ]),
    upstream
      ? runGitRepoAsync(rp, ["rev-list", "--left-right", "--count", `${upstream}...HEAD`])
      : Promise.resolve({ status: 1, stdout: "", stderr: "" }),
  ]);

  const branches = (branchResult.stdout || "")
    .trim()
    .split("\n")
    .filter(Boolean);

  const currentResult = runGitRepo(rp, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const currentBranch = (currentResult.stdout || "").trim() || "HEAD";

  const stashCount = (stashResult.stdout || "").trim()
    ? (stashResult.stdout.trim().split("\n").filter(Boolean).length)
    : 0;

  const hasChanges = (statusResult.stdout || "").trim().length > 0;

  const branchList = branches.map((b) => ({
    name: b,
    current: b === currentBranch,
    remote: null as string | null,
  }));

  let ahead = 0;
  let behind = 0;
  if (upstream && aheadBehindResult.status === 0) {
    // left = commits on upstream not in HEAD (behind); right = commits on HEAD not in upstream (ahead)
    const counts = parseLeftRightCount(aheadBehindResult.stdout || "");
    behind = counts.left;
    ahead = counts.right;
  } else if (!upstream) {
    ahead = parseUnpushedCommits(unpushedResult.stdout || "").length;
  }

  return NextResponse.json({
    branches: branchList,
    currentBranch,
    upstream,
    ahead,
    behind,
    stashCount,
    hasChanges,
    changedFiles: parseChangedFiles(statusResult.stdout || ""),
    unpushedCommits: parseUnpushedCommits(unpushedResult.stdout || ""),
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  const { name } = await params;
  const rp = resolveScannedRepo(name);
  if (!rp) {
    return NextResponse.json({ error: "Unknown repo" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({})) as {
    action?: string;
    branch?: string;
    message?: string;
    force?: boolean;
    amend?: boolean;
    commit?: string;
  };

  switch (body.action) {
    case "checkout": {
      if (!body.branch || typeof body.branch !== "string") {
        return NextResponse.json({ error: "Missing branch name" }, { status: 400 });
      }
      const status = await runGitRepoAsync(rp, ["status", "--porcelain"]);
      const hasChanges = (status.stdout || "").trim().length > 0;
      let stashed = false;

      if (hasChanges) {
        const prep = prepareGitIndexWrite(rp);
        if (!prep.ok) return indexLockResponse(rp, prep.error);

        const stash = await runGitRepoAsync(rp, [
          "stash",
          "push",
          "--include-untracked",
          "-m",
          `DevHub auto-stash before switching to ${body.branch}`,
        ]);
        if (stash.status !== 0) {
          const gitError = stash.stderr.trim() || stash.stdout.trim() || "Stash failed";
          if (looksLikeIndexLockError(stash.stderr, stash.stdout)) {
            return indexLockResponse(rp, gitError);
          }
          return NextResponse.json({ error: gitError }, { status: 500 });
        }
        stashed = true;
      }

      const out = await runGitRepoAsync(rp, ["checkout", body.branch]);
      if (out.status !== 0) {
        return NextResponse.json(
          { error: out.stderr.trim() || out.stdout.trim() || "Checkout failed" },
          { status: 500 },
        );
      }

      if (stashed) {
        const pop = await runGitRepoAsync(rp, ["stash", "pop", "stash@{0}"]);
        if (pop.status !== 0) {
          const gitError =
            pop.stderr.trim() || pop.stdout.trim() || "Switched branch, but stash apply failed";
          const conflictFiles = detectUnmergedFiles(rp);
          if (conflictFiles.length > 0 || looksLikeStashConflict(pop.stderr, pop.stdout)) {
            return stashConflictResponse("checkout", rp, gitError, {
              branch: body.branch,
              switched: true,
            });
          }
          return NextResponse.json({ error: gitError }, { status: 500 });
        }
      }

      return NextResponse.json({ ok: true, stashed });
    }

    case "stash-save": {
      const prep = prepareGitIndexWrite(rp);
      if (!prep.ok) return indexLockResponse(rp, prep.error);

      const args = ["stash", "push", "--include-untracked"];
      if (body.message?.trim()) args.push("-m", body.message.trim());
      const out = await runGitRepoAsync(rp, args);
      if (out.status !== 0) {
        const gitError = out.stderr.trim() || out.stdout.trim() || "Stash failed";
        if (looksLikeIndexLockError(out.stderr, out.stdout)) {
          return indexLockResponse(rp, gitError);
        }
        return NextResponse.json({ error: gitError }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    case "stash-apply": {
      const out = await runGitRepoAsync(rp, ["stash", "apply"]);
      if (out.status !== 0) {
        const gitError = out.stderr.trim() || out.stdout.trim() || "Stash apply failed";
        const conflictFiles = detectUnmergedFiles(rp);
        if (conflictFiles.length > 0 || looksLikeStashConflict(out.stderr, out.stdout)) {
          return stashConflictResponse("stash-apply", rp, gitError, { switched: false });
        }
        return NextResponse.json({ error: gitError }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    case "discard": {
      const reset = await runGitRepoAsync(rp, ["reset", "--hard", "HEAD"]);
      if (reset.status !== 0) {
        return NextResponse.json(
          { error: reset.stderr.trim() || reset.stdout.trim() || "Reset failed" },
          { status: 500 },
        );
      }
      const clean = await runGitRepoAsync(rp, ["clean", "-fd"]);
      if (clean.status !== 0) {
        return NextResponse.json(
          { error: clean.stderr.trim() || clean.stdout.trim() || "Clean failed" },
          { status: 500 },
        );
      }
      return NextResponse.json({ ok: true });
    }

    case "commit": {
      if (!body.message || typeof body.message !== "string") {
        return NextResponse.json({ error: "Missing commit message" }, { status: 400 });
      }
      // Prefer committing only what's already staged; fall back to add -A when empty.
      const staged = await runGitRepoAsync(rp, ["diff", "--cached", "--name-only"]);
      if ((staged.stdout || "").trim().length === 0 && !body.amend) {
        const add = await runGitRepoAsync(rp, ["add", "-A"]);
        if (add.status !== 0) {
          return NextResponse.json(
            { error: add.stderr.trim() || add.stdout.trim() || "Stage failed" },
            { status: 500 },
          );
        }
      }
      const commitArgs = body.amend
        ? ["commit", "--amend", "-m", body.message]
        : ["commit", "-m", body.message];
      if (body.amend) {
        const dirty = await runGitRepoAsync(rp, ["status", "--porcelain"]);
        // Amend only when working tree is clean or we have staged changes — refuse dirty unstaged-only amend.
        const porcelain = (dirty.stdout || "").trim();
        const hasUnstaged = porcelain.split("\n").some((line) => {
          if (!line || line.startsWith("??")) return true;
          return line.length >= 2 && line[1] !== " ";
        });
        const hasStaged = (staged.stdout || "").trim().length > 0;
        if (hasUnstaged && !hasStaged) {
          return NextResponse.json(
            { error: "Working tree has unstaged changes — stage or discard before amend." },
            { status: 400 },
          );
        }
      }
      const commit = await runGitRepoAsync(rp, commitArgs);
      if (commit.status !== 0) {
        const phase: GitHookPhase = body.amend ? "amend" : "commit";
        const hookRes = hookFailureResponse(rp, commit.stdout, commit.stderr, phase);
        if (hookRes) return hookRes;
        return NextResponse.json(
          { error: commit.stderr.trim() || commit.stdout.trim() || "Commit failed" },
          { status: 500 },
        );
      }
      return NextResponse.json({ ok: true, amended: Boolean(body.amend) });
    }

    case "push": {
      const push = await runGitRepoAsync(rp, ["push"]);
      if (push.status !== 0) {
        const hookRes = hookFailureResponse(rp, push.stdout, push.stderr, "push");
        if (hookRes) return hookRes;
        const detail =
          [push.stdout.trim(), push.stderr.trim()].filter(Boolean).join("\n") || "Push failed";
        const timedOut = /timed out after/i.test(detail);
        return NextResponse.json({ error: detail }, { status: timedOut ? 504 : 500 });
      }
      const combined = `${push.stdout}\n${push.stderr}`;
      if (/everything up-to-date/i.test(combined)) {
        return NextResponse.json({
          ok: true,
          alreadyUpToDate: true,
          message: "Already up to date — nothing to push.",
        });
      }
      return NextResponse.json({ ok: true });
    }

    case "fetch": {
      const fetch = await runGitRepoAsync(rp, ["fetch", "--all", "--prune"], { timeout: 120_000 });
      if (fetch.status !== 0) {
        return NextResponse.json(
          { error: fetch.stderr.trim() || fetch.stdout.trim() || "Fetch failed" },
          { status: 500 },
        );
      }
      return NextResponse.json({ ok: true });
    }

    case "pull": {
      const upstream = await resolveUpstream(rp);
      if (!upstream) {
        return NextResponse.json(
          { error: "No upstream branch — set upstream or push with -u first." },
          { status: 400 },
        );
      }
      const counts = await runGitRepoAsync(rp, [
        "rev-list",
        "--left-right",
        "--count",
        `${upstream}...HEAD`,
      ]);
      if (counts.status === 0) {
        const { left: behind } = parseLeftRightCount(counts.stdout || "");
        if (behind === 0) {
          return NextResponse.json({
            ok: true,
            alreadyUpToDate: true,
            message: "Already up to date — nothing to pull.",
          });
        }
      }
      const pull = await runGitRepoAsync(rp, ["pull", "--ff-only"], { timeout: 120_000 });
      if (pull.status !== 0) {
        return NextResponse.json(
          { error: pullFailureMessage(pull.stderr, pull.stdout) },
          { status: 500 },
        );
      }
      const msg = (pull.stdout || "").trim();
      return NextResponse.json({
        ok: true,
        alreadyUpToDate: /already up to date/i.test(msg),
        message: msg || undefined,
      });
    }

    case "create-branch": {
      if (!body.branch || typeof body.branch !== "string") {
        return NextResponse.json({ error: "Missing branch name" }, { status: 400 });
      }
      if (!/^[A-Za-z0-9._/-]+$/.test(body.branch) || body.branch.includes("..")) {
        return NextResponse.json({ error: "Invalid branch name" }, { status: 400 });
      }
      const create = await runGitRepoAsync(rp, ["checkout", "-b", body.branch]);
      if (create.status !== 0) {
        return NextResponse.json(
          { error: create.stderr.trim() || create.stdout.trim() || "Create branch failed" },
          { status: 500 },
        );
      }
      return NextResponse.json({ ok: true, branch: body.branch });
    }

    case "delete-branch": {
      if (!body.branch || typeof body.branch !== "string") {
        return NextResponse.json({ error: "Missing branch name" }, { status: 400 });
      }
      const current = runGitRepo(rp, ["rev-parse", "--abbrev-ref", "HEAD"]);
      if ((current.stdout || "").trim() === body.branch) {
        return NextResponse.json({ error: "Cannot delete the current branch" }, { status: 400 });
      }
      const del = await runGitRepoAsync(rp, ["branch", body.force ? "-D" : "-d", body.branch]);
      if (del.status !== 0) {
        return NextResponse.json(
          { error: del.stderr.trim() || del.stdout.trim() || "Delete branch failed" },
          { status: 500 },
        );
      }
      return NextResponse.json({ ok: true });
    }

    case "undo-commit": {
      // Soft reset — keep changes staged.
      const log = await runGitRepoAsync(rp, ["rev-list", "--count", "HEAD"]);
      const count = Number((log.stdout || "").trim());
      if (!Number.isFinite(count) || count < 1) {
        return NextResponse.json({ error: "Nothing to undo" }, { status: 400 });
      }
      const reset = await runGitRepoAsync(rp, ["reset", "--soft", "HEAD~1"]);
      if (reset.status !== 0) {
        return NextResponse.json(
          { error: reset.stderr.trim() || reset.stdout.trim() || "Undo failed" },
          { status: 500 },
        );
      }
      return NextResponse.json({ ok: true });
    }

    case "reset-stash-ahead": {
      // Soft-reset to an ancestor, then stash the staged ahead work. No force-push.
      const commit =
        typeof body.commit === "string" ? body.commit.trim() : "";
      if (
        !commit ||
        commit.length > 128 ||
        commit.includes("..") ||
        commit.includes("\0") ||
        /\s/.test(commit) ||
        !/^[0-9a-fA-F]{4,40}$/.test(commit)
      ) {
        return NextResponse.json({ error: "Invalid commit" }, { status: 400 });
      }

      const resolvedCommit = await runGitRepoAsync(rp, ["rev-parse", "--verify", `${commit}^{commit}`]);
      if (resolvedCommit.status !== 0) {
        return NextResponse.json(
          { error: resolvedCommit.stderr.trim() || "Commit not found" },
          { status: 400 },
        );
      }
      const targetHash = (resolvedCommit.stdout || "").trim();
      const short = await runGitRepoAsync(rp, ["rev-parse", "--short", targetHash]);
      const targetShort =
        short.status === 0 ? (short.stdout || "").trim() : targetHash.slice(0, 7);

      const head = await runGitRepoAsync(rp, ["rev-parse", "HEAD"]);
      if (head.status !== 0) {
        return NextResponse.json(
          { error: head.stderr.trim() || "Could not resolve HEAD" },
          { status: 500 },
        );
      }
      const headHash = (head.stdout || "").trim();
      if (headHash === targetHash) {
        return NextResponse.json(
          { error: "Already at this commit — nothing to reset." },
          { status: 400 },
        );
      }

      const ancestor = await runGitRepoAsync(rp, [
        "merge-base",
        "--is-ancestor",
        targetHash,
        "HEAD",
      ]);
      if (ancestor.status !== 0) {
        return NextResponse.json(
          {
            error:
              "Selected commit is not an ancestor of HEAD — diverged history can't use stash-ahead reset.",
          },
          { status: 400 },
        );
      }

      const countRes = await runGitRepoAsync(rp, [
        "rev-list",
        "--count",
        `${targetHash}..HEAD`,
      ]);
      const aheadCount = Number((countRes.stdout || "").trim());
      if (countRes.status !== 0 || !Number.isFinite(aheadCount) || aheadCount < 1) {
        return NextResponse.json(
          { error: "No commits ahead of the selected commit." },
          { status: 400 },
        );
      }

      const dirty = await runGitRepoAsync(rp, ["status", "--porcelain"]);
      if ((dirty.stdout || "").trim().length > 0) {
        return NextResponse.json(
          {
            error:
              "Working tree is dirty — commit or stash your changes before resetting with stash-ahead.",
          },
          { status: 400 },
        );
      }

      const prep = prepareGitIndexWrite(rp);
      if (!prep.ok) return indexLockResponse(rp, prep.error);

      const backupName = `devhub/backup-${new Date()
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d+Z$/, "")
        .replace("T", "-")}`;
      const backup = await runGitRepoAsync(rp, ["branch", backupName, "HEAD"]);
      const backupBranch = backup.status === 0 ? backupName : null;

      const soft = await runGitRepoAsync(rp, ["reset", "--soft", targetHash]);
      if (soft.status !== 0) {
        return NextResponse.json(
          {
            error: soft.stderr.trim() || soft.stdout.trim() || "Soft reset failed",
            backupBranch,
          },
          { status: 500 },
        );
      }

      const stashMsg = `DevHub: ${aheadCount} commit${aheadCount === 1 ? "" : "s"} ahead of ${targetShort}`;
      const stash = await runGitRepoAsync(rp, [
        "stash",
        "push",
        "--include-untracked",
        "-m",
        stashMsg,
      ]);
      if (stash.status !== 0) {
        const gitError = stash.stderr.trim() || stash.stdout.trim() || "Stash failed";
        if (looksLikeIndexLockError(stash.stderr, stash.stdout)) {
          return indexLockResponse(rp, gitError);
        }
        // Soft reset already moved HEAD — empty commits may leave nothing to stash.
        if (/no local changes to save/i.test(gitError)) {
          return NextResponse.json({
            ok: true,
            aheadCount,
            commit: targetHash,
            shortHash: targetShort,
            stashRef: null,
            stashMessage: null,
            backupBranch,
            message: `Reset to ${targetShort}. No file changes to stash (empty commits?).`,
          });
        }
        return NextResponse.json(
          {
            error: `${gitError}${
              backupBranch
                ? ` Soft reset already applied — recover via branch ${backupBranch}.`
                : " Soft reset already applied — recover from reflog."
            }`,
            backupBranch,
          },
          { status: 500 },
        );
      }

      return NextResponse.json({
        ok: true,
        aheadCount,
        commit: targetHash,
        shortHash: targetShort,
        stashRef: "stash@{0}",
        stashMessage: stashMsg,
        backupBranch,
      });
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  }
}
