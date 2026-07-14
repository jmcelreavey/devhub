import { NextResponse, type NextRequest } from "next/server";
import path from "node:path";
import fs from "node:fs";
import { getReposScanDir } from "@/lib/repos";
import { runGitRepo, runGitRepoAsync } from "@/lib/git-repo-local";
import { parseChangedFiles, parseUnpushedCommits } from "./parsers";

type Params = { params: Promise<{ name: string }> };

async function currentBranchUnpushedLogArgs(repoRoot: string): Promise<string[]> {
  const upstream = await runGitRepoAsync(repoRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  const ref = upstream.stdout.trim();
  return upstream.status === 0 && ref ? [`${ref}..HEAD`] : ["HEAD", "--not", "--remotes"];
}

function repoPath(name: string): string | null {
  const scanDir = getReposScanDir();
  const rp = path.resolve(path.join(scanDir, name));
  if (path.dirname(rp) !== path.resolve(scanDir)) return null;
  if (!fs.existsSync(path.join(rp, ".git"))) return null;
  return rp;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { name } = await params;
  const rp = repoPath(name);
  if (!rp) {
    return NextResponse.json({ error: "Unknown repo" }, { status: 404 });
  }

  const [branchResult, stashResult, statusResult, unpushedLogArgs] = await Promise.all([
    runGitRepoAsync(rp, ["branch", "--list", "--format=%(refname:short)"]),
    runGitRepoAsync(rp, ["stash", "list"]),
    runGitRepoAsync(rp, ["status", "--porcelain"]),
    currentBranchUnpushedLogArgs(rp),
  ]);
  const unpushedResult = await runGitRepoAsync(rp, ["log", ...unpushedLogArgs, "--format=%x1e%h%x00%s", "--name-only"]);

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

  return NextResponse.json({
    branches: branchList,
    currentBranch,
    stashCount,
    hasChanges,
    changedFiles: parseChangedFiles(statusResult.stdout || ""),
    unpushedCommits: parseUnpushedCommits(unpushedResult.stdout || ""),
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  const { name } = await params;
  const rp = repoPath(name);
  if (!rp) {
    return NextResponse.json({ error: "Unknown repo" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({})) as {
    action?: string;
    branch?: string;
    message?: string;
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
        const stash = await runGitRepoAsync(rp, [
          "stash",
          "push",
          "--include-untracked",
          "-m",
          `DevHub auto-stash before switching to ${body.branch}`,
        ]);
        if (stash.status !== 0) {
          return NextResponse.json(
            { error: stash.stderr.trim() || stash.stdout.trim() || "Stash failed" },
            { status: 500 },
          );
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
          return NextResponse.json(
            { error: pop.stderr.trim() || pop.stdout.trim() || "Switched branch, but stash apply failed" },
            { status: 500 },
          );
        }
      }

      return NextResponse.json({ ok: true, stashed });
    }

    case "stash-save": {
      const args = ["stash", "push", "--include-untracked"];
      if (body.message) args.push("-m", body.message);
      const out = await runGitRepoAsync(rp, args);
      if (out.status !== 0) {
        return NextResponse.json(
          { error: out.stderr.trim() || out.stdout.trim() || "Stash failed" },
          { status: 500 },
        );
      }
      return NextResponse.json({ ok: true });
    }

    case "stash-apply": {
      const out = await runGitRepoAsync(rp, ["stash", "apply"]);
      if (out.status !== 0) {
        return NextResponse.json(
          { error: out.stderr.trim() || out.stdout.trim() || "Stash apply failed" },
          { status: 500 },
        );
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
      const add = await runGitRepoAsync(rp, ["add", "-A"]);
      if (add.status !== 0) {
        return NextResponse.json(
          { error: add.stderr.trim() || add.stdout.trim() || "Stage failed" },
          { status: 500 },
        );
      }
      const commit = await runGitRepoAsync(rp, ["commit", "-m", body.message]);
      if (commit.status !== 0) {
        return NextResponse.json(
          { error: commit.stderr.trim() || commit.stdout.trim() || "Commit failed" },
          { status: 500 },
        );
      }
      return NextResponse.json({ ok: true });
    }

    case "push": {
      const push = await runGitRepoAsync(rp, ["push"]);
      if (push.status !== 0) {
        return NextResponse.json(
          { error: push.stderr.trim() || push.stdout.trim() || "Push failed" },
          { status: 500 },
        );
      }
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  }
}
