import { NextResponse, type NextRequest } from "next/server";
import {
  readOriginRemoteUrl,
  readRemoteUrl,
  remoteWebUrl,
  resolveDefaultRemoteBranch,
  runGitRepo,
  runGitRepoAsync,
  type GitRepoRunResult,
} from "@/lib/git/repo-local";
import { detectUnmergedFiles } from "@/lib/git/conflicts";
import { isSafeRemoteName, parseRemotes, remoteOfUpstream } from "@/lib/repos/remote-parsers";
import {
  formatIndexLockError,
  looksLikeIndexLockError,
  prepareGitIndexWrite,
} from "@/lib/git/index-lock";
import { detectGitHookFailure, type GitHookPhase } from "@/lib/git/hook-failure";
import { withPersistedLog } from "@/lib/git/hook-failure-persist";
import { resolveScannedRepo } from "@/lib/scanned-repo";
import type { StashConflictPayload } from "@/app/repos/types";
import {
  isSafeBranchName,
  parseChangedFiles,
  parseLeftRightCount,
  parseUnpushedCommits,
} from "./parsers";

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
  extras: { branch?: string; switched: boolean; syncTarget?: string; stashed?: boolean },
): NextResponse {
  const conflictFiles = detectUnmergedFiles(repoRoot).map((f) => f.path);
  const payload: StashConflictPayload = {
    code: "stash_conflict",
    action,
    branch: extras.branch,
    switched: extras.switched,
    conflictFiles,
    error: gitError || "Stash apply left conflicts",
    syncTarget: extras.syncTarget,
    stashed: extras.stashed,
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

/**
 * Timestamped `devhub/backup-*` ref, taken before anything that rewrites the
 * branch pointer. Cheaper to reason about than reflog archaeology.
 */
function devhubBackupBranchName(): string {
  return `devhub/backup-${new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "")
    .replace("T", "-")}`;
}

function invalidBranch(): NextResponse {
  return NextResponse.json({ error: "Invalid branch name" }, { status: 400 });
}

async function currentBranchName(repoRoot: string): Promise<string | null> {
  const head = await runGitRepoAsync(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = head.stdout.trim();
  return head.status === 0 && branch && branch !== "HEAD" ? branch : null;
}

/**
 * Turn git's push diagnostics into something actionable.
 *
 * The raw "fatal: The current branch X has no upstream branch" is accurate and
 * useless — DevHub now sets the upstream itself, so if the user still sees a
 * push error it should say what *they* have to do about it.
 */
function pushFailureMessage(stderr: string, stdout: string): string {
  const text = `${stderr}\n${stdout}`.trim();
  if (/no upstream branch|has no upstream/i.test(text)) {
    return "No upstream branch and DevHub could not create one — check that this repo has an `origin` remote.";
  }
  if (/non-fast-forward|fetch first|rejected.*behind/i.test(text)) {
    return "Push rejected: upstream has commits you don't have. Pull (or sync) first, then push.";
  }
  if (/authentication|could not read|permission denied|403/i.test(text)) {
    return "Push rejected by the remote (auth). Run `gh auth login`, or check your credentials for this remote.";
  }
  if (/timed out after/i.test(text)) return text;
  return text || "Push failed";
}

/**
 * Push a branch, creating the upstream when it has none.
 *
 * Bare `git push` fatals on a branch that has never been pushed, which is
 * exactly the branch you most want to push. `sync-main` had always handled
 * this; the standalone push button had not, so the header Push button on a
 * fresh branch could only ever fail.
 */
async function pushBranch(
  repoRoot: string,
  branch: string | null,
  hasUpstream: boolean,
  remote?: string,
): Promise<GitRepoRunResult> {
  // `origin` remains the default, but it is now a default rather than an
  // assumption: on a fork-based workflow the branch belongs on your fork, and
  // hardcoding origin either pushed to the wrong place or failed outright.
  const target = remote && isSafeRemoteName(remote) ? remote : "origin";
  const args =
    hasUpstream && !remote
      ? ["push"]
      : branch
        ? ["push", "--set-upstream", target, branch]
        : ["push"];
  return runGitRepoAsync(repoRoot, args, { timeout: 300_000 });
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

  const [branchResult, remoteBranchResult, stashResult, statusResult, upstream, mainBranch] =
    await Promise.all([
    // NUL-separated so branch metadata survives names with odd characters, and
    // so the context menu can tell "has an upstream" from "never pushed"
    // without a round trip per branch.
    runGitRepoAsync(rp, [
      "branch",
      "--list",
      "--format=%(refname:short)%00%(upstream:short)%00%(objectname:short)",
    ]),
    runGitRepoAsync(rp, [
      "branch",
      "--remotes",
      "--format=%(refname:short)%00%(objectname:short)",
    ]),
    runGitRepoAsync(rp, ["stash", "list"]),
    runGitRepoAsync(rp, ["status", "--porcelain"]),
    resolveUpstream(rp),
    resolveDefaultRemoteBranch(rp),
    ]);
  const [unpushedResult, aheadBehindResult, mainAheadBehindResult] = await Promise.all([
    runGitRepoAsync(rp, [
      "log",
      ...unpushedLogArgs(upstream),
      "--format=%x1e%H%x00%h%x00%s",
      "--name-only",
    ]),
    upstream
      ? runGitRepoAsync(rp, ["rev-list", "--left-right", "--count", `${upstream}...HEAD`])
      : Promise.resolve({ status: 1, stdout: "", stderr: "" }),
    mainBranch
      ? runGitRepoAsync(rp, ["rev-list", "--left-right", "--count", `${mainBranch}...HEAD`])
      : Promise.resolve({ status: 1, stdout: "", stderr: "" }),
  ]);

  // Needed to resolve which remote the current branch's web links belong to.
  const remotesResult = await runGitRepoAsync(rp, ["remote", "-v"]);

  const branches = (branchResult.stdout || "")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name = "", branchUpstream = "", shortHash = ""] = line.split("\0");
      return { name: name.trim(), upstream: branchUpstream.trim() || null, shortHash };
    })
    .filter((b) => b.name);

  const currentResult = runGitRepo(rp, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const currentBranch = (currentResult.stdout || "").trim() || "HEAD";

  const stashCount = (stashResult.stdout || "").trim()
    ? (stashResult.stdout.trim().split("\n").filter(Boolean).length)
    : 0;

  const hasChanges = (statusResult.stdout || "").trim().length > 0;

  const branchList = branches.map((b) => ({
    name: b.name,
    current: b.name === currentBranch,
    remote: b.upstream,
    upstream: b.upstream,
    shortHash: b.shortHash,
  }));
  const remoteBranches = (remoteBranchResult.stdout || "")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name = "", shortHash = ""] = line.split("\0");
      const slash = name.indexOf("/");
      if (slash < 1) return null;
      const remote = name.slice(0, slash);
      const localName = name.slice(slash + 1);
      if (!localName || localName === "HEAD") return null;
      return {
        name,
        remote,
        localName,
        shortHash,
        trackedLocalName: branches.find((branch) => branch.upstream === name)?.name ?? null,
      };
    })
    .filter((branch): branch is NonNullable<typeof branch> => branch !== null);

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
  const mainCounts = mainAheadBehindResult.status === 0 ? parseLeftRightCount(mainAheadBehindResult.stdout) : { left: 0, right: 0 };

  return NextResponse.json({
    branches: branchList,
    remoteBranches,
    currentBranch,
    upstream,
    ahead,
    behind,
    stashCount,
    hasChanges,
    changedFiles: parseChangedFiles(statusResult.stdout || ""),
    unpushedCommits: parseUnpushedCommits(unpushedResult.stdout || ""),
    mainBranch,
    aheadMain: mainCounts.right,
    behindMain: mainCounts.left,
    // Follows the branch's own upstream rather than always origin: on a fork
    // workflow the code is on the fork, and an origin-shaped link 404s.
    remoteWebUrl: remoteWebUrl(
      readRemoteUrl(rp, remoteOfUpstream(upstream, parseRemotes(remotesResult.stdout || "")) ?? "origin") ??
        readOriginRemoteUrl(rp),
    ),
    remotes: parseRemotes(remotesResult.stdout || ""),
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
    /** Target name for create/rename. */
    newBranch?: string;
    message?: string;
    force?: boolean;
    amend?: boolean;
    commit?: string;
    /** reset-to-branch: how much of the working tree to move with HEAD. */
    mode?: "soft" | "mixed" | "hard";
    /** branch-from: switch to the new branch after creating it. */
    checkout?: boolean;
    /** push: which remote to send to. Defaults to origin when absent. */
    remote?: string;
  };

  switch (body.action) {
    case "checkout":
    case "checkout-remote": {
      if (!body.branch || typeof body.branch !== "string") {
        return NextResponse.json({ error: "Missing branch name" }, { status: 400 });
      }
      const remoteCheckout = body.action === "checkout-remote";
      if (!isSafeBranchName(body.branch)) return invalidBranch();
      if (remoteCheckout) {
        if (!isSafeBranchName(body.newBranch)) return invalidBranch();
        const exists = await runGitRepoAsync(rp, [
          "show-ref",
          "--verify",
          "--quiet",
          `refs/remotes/${body.branch}`,
        ]);
        if (exists.status !== 0) {
          return NextResponse.json(
            { error: `Remote branch ${body.branch} no longer exists. Fetch and try again.` },
            { status: 404 },
          );
        }
      }
      const checkoutName = remoteCheckout ? body.newBranch! : body.branch;
      const unmerged = detectUnmergedFiles(rp);
      if (unmerged.length > 0) {
        return NextResponse.json(
          {
            error:
              `Cannot switch branches: ${unmerged.length} unmerged path${unmerged.length === 1 ? "" : "s"}. ` +
              "Resolve conflicts in the Conflicts tab (or abort the conflicted merge/stash) first.",
            conflictFiles: unmerged.map((f) => f.path),
          },
          { status: 409 },
        );
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
          `DevHub auto-stash before switching to ${checkoutName}`,
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

      const out = await runGitRepoAsync(
        rp,
        remoteCheckout
          ? ["checkout", "--track", "-b", checkoutName, body.branch]
          : ["checkout", body.branch],
      );
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
              branch: checkoutName,
              switched: true,
            });
          }
          return NextResponse.json({ error: gitError }, { status: 500 });
        }
      }

      return NextResponse.json({ ok: true, stashed, branch: checkoutName });
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
      const staged = await runGitRepoAsync(rp, ["diff", "--cached", "--name-only"]);
      if (staged.status !== 0) {
        return NextResponse.json(
          {
            error:
              staged.stderr.trim() || staged.stdout.trim() || "Could not inspect staged changes",
          },
          { status: 500 },
        );
      }
      if ((staged.stdout || "").trim().length === 0 && !body.amend) {
        return NextResponse.json(
          { error: "Nothing is staged — stage the files you want to commit first." },
          { status: 400 },
        );
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
      const prep = prepareGitIndexWrite(rp);
      if (!prep.ok) return indexLockResponse(rp, prep.error);

      const commit = await runGitRepoAsync(rp, commitArgs);
      if (commit.status !== 0) {
        const gitError = commit.stderr.trim() || commit.stdout.trim() || "Commit failed";
        if (looksLikeIndexLockError(commit.stderr, commit.stdout)) {
          return indexLockResponse(rp, gitError);
        }
        const phase: GitHookPhase = body.amend ? "amend" : "commit";
        const hookRes = hookFailureResponse(rp, commit.stdout, commit.stderr, phase);
        if (hookRes) return hookRes;
        return NextResponse.json(
          { error: gitError },
          { status: 500 },
        );
      }
      return NextResponse.json({ ok: true, amended: Boolean(body.amend) });
    }

    case "push": {
      const upstream = await resolveUpstream(rp);
      const branch = await currentBranchName(rp);
      if (!upstream && !branch) {
        return NextResponse.json(
          { error: "Cannot push a detached HEAD — check out a branch first." },
          { status: 400 },
        );
      }
      const push = await pushBranch(rp, branch, Boolean(upstream), body.remote);
      if (push.status !== 0) {
        const hookRes = hookFailureResponse(rp, push.stdout, push.stderr, "push");
        if (hookRes) return hookRes;
        const detail = pushFailureMessage(push.stderr, push.stdout);
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
      return NextResponse.json({
        ok: true,
        // Surfaced so the toast can say "Pushed and tracking origin/<branch>"
        // the first time a branch leaves this machine.
        setUpstream: !upstream && Boolean(branch),
        branch,
      });
    }

    case "force-push-with-lease": {
      const upstream = await resolveUpstream(rp);
      const branch = await currentBranchName(rp);
      if (!branch) {
        return NextResponse.json(
          { error: "Cannot force-push a detached HEAD. Check out a branch first." },
          { status: 400 },
        );
      }
      if (!upstream) {
        return NextResponse.json(
          { error: "This branch has no upstream. Push it normally first to create one." },
          { status: 400 },
        );
      }
      const [expected, remoteResult, mergeRefResult] = await Promise.all([
        runGitRepoAsync(rp, ["rev-parse", upstream]),
        runGitRepoAsync(rp, ["config", "--get", `branch.${branch}.remote`]),
        runGitRepoAsync(rp, ["config", "--get", `branch.${branch}.merge`]),
      ]);
      const expectedOid = expected.stdout.trim();
      const remote = remoteResult.stdout.trim();
      const remoteRef = mergeRefResult.stdout.trim();
      if (
        expected.status !== 0 ||
        !/^[0-9a-f]{40}$/i.test(expectedOid) ||
        remoteResult.status !== 0 ||
        !remote ||
        mergeRefResult.status !== 0 ||
        !remoteRef.startsWith("refs/heads/")
      ) {
        return NextResponse.json(
          { error: "Could not read the upstream branch and reviewed remote revision. Fetch and try again." },
          { status: 400 },
        );
      }
      const push = await runGitRepoAsync(rp, [
        "push",
        `--force-with-lease=${remoteRef}:${expectedOid}`,
        remote,
        `HEAD:${remoteRef}`,
      ], {
        timeout: 300_000,
      });
      if (push.status !== 0) {
        const hookRes = hookFailureResponse(rp, push.stdout, push.stderr, "push");
        if (hookRes) return hookRes;
        const detail = `${push.stderr}\n${push.stdout}`.trim();
        const error = /stale info|force-with-lease/i.test(detail)
          ? "Force push rejected: the remote changed since your last fetch. Fetch and review it before trying again."
          : pushFailureMessage(push.stderr, push.stdout);
        return NextResponse.json({ error }, { status: 500 });
      }
      return NextResponse.json({ ok: true, branch, upstream });
    }

    case "set-upstream": {
      if (!isSafeBranchName(body.branch)) return invalidBranch();
      const remoteRef = `origin/${body.branch}`;
      const exists = await runGitRepoAsync(rp, ["rev-parse", "--verify", "--quiet", remoteRef]);
      if (exists.status !== 0) {
        return NextResponse.json(
          { error: `${remoteRef} does not exist — push the branch first (that sets the upstream).` },
          { status: 400 },
        );
      }
      const set = await runGitRepoAsync(rp, [
        "branch",
        `--set-upstream-to=${remoteRef}`,
        body.branch,
      ]);
      if (set.status !== 0) {
        return NextResponse.json(
          { error: set.stderr.trim() || set.stdout.trim() || "Set upstream failed" },
          { status: 500 },
        );
      }
      return NextResponse.json({ ok: true, branch: body.branch, upstream: remoteRef });
    }

    case "merge-branch": {
      // Merge another branch *into* the checked-out one — the "get their work"
      // half of the context menu. Conflicts route to the Conflicts tab rather
      // than aborting, because a merge conflict is normal work, not an error.
      if (!isSafeBranchName(body.branch)) return invalidBranch();
      const current = await currentBranchName(rp);
      if (!current) {
        return NextResponse.json({ error: "Cannot merge into a detached HEAD." }, { status: 400 });
      }
      if (current === body.branch) {
        return NextResponse.json(
          { error: "That branch is already checked out — nothing to merge." },
          { status: 400 },
        );
      }
      const dirty = await runGitRepoAsync(rp, ["status", "--porcelain"]);
      if ((dirty.stdout || "").trim().length > 0) {
        return NextResponse.json(
          { error: "Working tree is dirty — commit or stash before merging." },
          { status: 400 },
        );
      }
      const merge = await runGitRepoAsync(rp, ["merge", "--no-edit", body.branch], {
        timeout: 120_000,
      });
      if (merge.status !== 0) {
        const error = merge.stderr.trim() || merge.stdout.trim() || `Merge ${body.branch} failed`;
        if (detectUnmergedFiles(rp).length || looksLikeStashConflict(merge.stderr, merge.stdout)) {
          return stashConflictResponse("merge-branch", rp, error, {
            branch: current,
            switched: false,
            syncTarget: body.branch,
            stashed: false,
          });
        }
        await runGitRepoAsync(rp, ["merge", "--abort"]);
        return NextResponse.json({ error }, { status: 500 });
      }
      const alreadyUpToDate = /already up to date/i.test(`${merge.stdout}\n${merge.stderr}`);
      return NextResponse.json({ ok: true, branch: body.branch, current, alreadyUpToDate });
    }

    case "rebase-branch": {
      // Replay the current branch on top of another. Rewrites local history,
      // so it refuses on a dirty tree and aborts cleanly on conflict — an
      // interactive conflicted rebase is not something a modal can babysit.
      if (!isSafeBranchName(body.branch)) return invalidBranch();
      const current = await currentBranchName(rp);
      if (!current) {
        return NextResponse.json({ error: "Cannot rebase a detached HEAD." }, { status: 400 });
      }
      if (current === body.branch) {
        return NextResponse.json({ error: "Cannot rebase a branch onto itself." }, { status: 400 });
      }
      const dirty = await runGitRepoAsync(rp, ["status", "--porcelain"]);
      if ((dirty.stdout || "").trim().length > 0) {
        return NextResponse.json(
          { error: "Working tree is dirty — commit or stash before rebasing." },
          { status: 400 },
        );
      }
      const backupName = devhubBackupBranchName();
      const backup = await runGitRepoAsync(rp, ["branch", backupName, "HEAD"]);
      if (backup.status !== 0) {
        return NextResponse.json(
          { error: backup.stderr.trim() || backup.stdout.trim() || "Could not create backup branch; rebase cancelled." },
          { status: 500 },
        );
      }
      const backupBranch = backupName;

      const rebase = await runGitRepoAsync(rp, ["rebase", body.branch], { timeout: 300_000 });
      if (rebase.status !== 0) {
        const error = rebase.stderr.trim() || rebase.stdout.trim() || "Rebase failed";
        await runGitRepoAsync(rp, ["rebase", "--abort"]);
        return NextResponse.json(
          {
            error: `${error}\nRebase aborted — the branch is back where it started${
              backupBranch ? ` (backup: ${backupBranch})` : ""
            }.`,
            backupBranch,
          },
          { status: 500 },
        );
      }
      return NextResponse.json({ ok: true, branch: body.branch, current, backupBranch });
    }

    case "branch-from": {
      // Create a branch at another branch's tip *without* switching to it.
      // Checking out would need the auto-stash dance, and "make me a branch
      // here" rarely means "and abandon what I'm doing".
      if (!isSafeBranchName(body.branch)) return invalidBranch();
      if (!isSafeBranchName(body.newBranch)) return invalidBranch();
      const create = await runGitRepoAsync(rp, ["branch", body.newBranch, body.branch]);
      if (create.status !== 0) {
        return NextResponse.json(
          { error: create.stderr.trim() || create.stdout.trim() || "Create branch failed" },
          { status: 500 },
        );
      }
      if (body.checkout) {
        const checkout = await runGitRepoAsync(rp, ["checkout", body.newBranch]);
        if (checkout.status !== 0) {
          return NextResponse.json(
            {
              error: `Created ${body.newBranch}, but checkout failed: ${
                checkout.stderr.trim() || checkout.stdout.trim()
              }`,
            },
            { status: 500 },
          );
        }
      }
      return NextResponse.json({
        ok: true,
        branch: body.newBranch,
        from: body.branch,
        checkedOut: Boolean(body.checkout),
      });
    }

    case "rename-branch": {
      if (!isSafeBranchName(body.branch)) return invalidBranch();
      if (!isSafeBranchName(body.newBranch)) return invalidBranch();
      if (body.branch === body.newBranch) {
        return NextResponse.json({ error: "That is already the branch name." }, { status: 400 });
      }
      const rename = await runGitRepoAsync(rp, ["branch", "-m", body.branch, body.newBranch]);
      if (rename.status !== 0) {
        return NextResponse.json(
          { error: rename.stderr.trim() || rename.stdout.trim() || "Rename failed" },
          { status: 500 },
        );
      }
      return NextResponse.json({ ok: true, branch: body.newBranch, from: body.branch });
    }

    case "reset-to-branch": {
      // "Reset current branch to here". Hard mode discards the working tree, so
      // it only runs on a clean tree and always leaves a backup branch behind.
      if (!isSafeBranchName(body.branch)) return invalidBranch();
      const mode = body.mode === "hard" ? "hard" : body.mode === "soft" ? "soft" : "mixed";
      const current = await currentBranchName(rp);
      if (!current) {
        return NextResponse.json({ error: "Cannot reset a detached HEAD." }, { status: 400 });
      }
      if (current === body.branch) {
        return NextResponse.json({ error: "Cannot reset a branch to itself." }, { status: 400 });
      }
      if (mode === "hard") {
        const dirty = await runGitRepoAsync(rp, ["status", "--porcelain"]);
        if ((dirty.stdout || "").trim().length > 0) {
          return NextResponse.json(
            {
              error:
                "Working tree is dirty — a hard reset would delete those changes. Commit or stash first.",
            },
            { status: 400 },
          );
        }
      }
      const backupName = devhubBackupBranchName();
      const backup = await runGitRepoAsync(rp, ["branch", backupName, "HEAD"]);
      if (backup.status !== 0) {
        return NextResponse.json(
          { error: backup.stderr.trim() || backup.stdout.trim() || "Could not create backup branch; reset cancelled." },
          { status: 500 },
        );
      }
      const backupBranch = backupName;

      const prep = prepareGitIndexWrite(rp);
      if (!prep.ok) return indexLockResponse(rp, prep.error);

      const reset = await runGitRepoAsync(rp, ["reset", `--${mode}`, body.branch]);
      if (reset.status !== 0) {
        return NextResponse.json(
          {
            error: reset.stderr.trim() || reset.stdout.trim() || "Reset failed",
            backupBranch,
          },
          { status: 500 },
        );
      }
      return NextResponse.json({ ok: true, branch: body.branch, current, mode, backupBranch });
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

    case "sync-main": {
      const current = await runGitRepoAsync(rp, ["rev-parse", "--abbrev-ref", "HEAD"]);
      const currentBranch = current.stdout.trim();
      if (current.status !== 0 || !currentBranch || currentBranch === "HEAD") return NextResponse.json({ error: "Cannot sync a detached HEAD." }, { status: 400 });
      const mainBranch = await resolveDefaultRemoteBranch(rp);
      if (!mainBranch) return NextResponse.json({ error: "Could not find origin/main or origin/master." }, { status: 400 });

      const status = await runGitRepoAsync(rp, ["status", "--porcelain"]);
      const stashed = status.stdout.trim().length > 0;
      if (stashed) {
        const prep = prepareGitIndexWrite(rp);
        if (!prep.ok) return indexLockResponse(rp, prep.error);
        const stash = await runGitRepoAsync(rp, ["stash", "push", "--include-untracked", "-m", `DevHub auto-stash before syncing ${currentBranch} with ${mainBranch}`]);
        if (stash.status !== 0) return NextResponse.json({ error: stash.stderr.trim() || stash.stdout.trim() || "Stash failed" }, { status: 500 });
      }

      const remoteBranch = mainBranch.slice("origin/".length);
      const fetch = await runGitRepoAsync(rp, ["fetch", "origin", remoteBranch, "--prune"], { timeout: 120_000 });
      if (fetch.status !== 0) {
        if (stashed) {
          const pop = await runGitRepoAsync(rp, ["stash", "pop", "stash@{0}"]);
          if (pop.status !== 0) return stashConflictResponse("sync-main", rp, pop.stderr.trim() || pop.stdout.trim(), { branch: currentBranch, switched: false, syncTarget: mainBranch, stashed: true });
        }
        return NextResponse.json({ error: fetch.stderr.trim() || fetch.stdout.trim() || "Fetch failed" }, { status: 500 });
      }

      const merge = await runGitRepoAsync(rp, ["merge", "--no-edit", mainBranch], { timeout: 120_000 });
      if (merge.status !== 0) {
        const error = merge.stderr.trim() || merge.stdout.trim() || `Merge ${mainBranch} failed`;
        if (detectUnmergedFiles(rp).length || looksLikeStashConflict(merge.stderr, merge.stdout)) {
          return stashConflictResponse("sync-main", rp, error, { branch: currentBranch, switched: false, syncTarget: mainBranch, stashed });
        }
        await runGitRepoAsync(rp, ["merge", "--abort"]);
        if (stashed) {
          const pop = await runGitRepoAsync(rp, ["stash", "pop", "stash@{0}"]);
          if (pop.status !== 0) return stashConflictResponse("sync-main", rp, pop.stderr.trim() || pop.stdout.trim(), { branch: currentBranch, switched: false, syncTarget: mainBranch, stashed: true });
        }
        return NextResponse.json({ error }, { status: 500 });
      }

      const push = await runGitRepoAsync(rp, (await resolveUpstream(rp)) ? ["push"] : ["push", "-u", "origin", currentBranch], { timeout: 300_000 });
      if (stashed) {
        const pop = await runGitRepoAsync(rp, ["stash", "pop", "stash@{0}"]);
        if (pop.status !== 0) return stashConflictResponse("sync-main", rp, pop.stderr.trim() || pop.stdout.trim(), { branch: currentBranch, switched: false, syncTarget: mainBranch, stashed: true });
      }
      if (push.status !== 0) {
        const hook = hookFailureResponse(rp, push.stdout, push.stderr, "push");
        if (hook) return hook;
        return NextResponse.json({ error: push.stderr.trim() || push.stdout.trim() || "Push failed" }, { status: 500 });
      }
      return NextResponse.json({ ok: true, mainBranch, currentBranch, stashed });
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

      const backupName = devhubBackupBranchName();
      const backup = await runGitRepoAsync(rp, ["branch", backupName, "HEAD"]);
      if (backup.status !== 0) {
        return NextResponse.json(
          { error: backup.stderr.trim() || backup.stdout.trim() || "Could not create backup branch; reset cancelled." },
          { status: 500 },
        );
      }
      const backupBranch = backupName;

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
