import fs from "node:fs";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { runGitRepoAsync } from "@/lib/git-repo-local";
import { looksLikeDirectoryPath, parseUnifiedDiff } from "@/lib/repo-git-parsers";
import { gitFail, withScannedRepo, type RepoParams } from "../_shared";

interface DirEntry {
  name: string;
  type: "file" | "dir";
}

function resolveUnderRepo(repoRoot: string, rel: string): string | null {
  if (!rel || rel.includes("\0") || rel.includes("..") || path.isAbsolute(rel)) return null;
  const root = path.resolve(repoRoot);
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

function listDirectoryEntries(absDir: string): DirEntry[] {
  try {
    return fs
      .readdirSync(absDir, { withFileTypes: true })
      .filter((e) => e.name !== ".DS_Store")
      .map((e) => ({
        name: e.name,
        type: e.isDirectory() ? ("dir" as const) : ("file" as const),
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;
  const { repoRoot } = resolved;

  const filePath = req.nextUrl.searchParams.get("path");
  const staged = req.nextUrl.searchParams.get("staged") === "1";
  const stashRef = req.nextUrl.searchParams.get("stash");

  if (filePath && (filePath.includes("..") || path.isAbsolute(filePath))) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  let result;
  if (stashRef) {
    result = await runGitRepoAsync(
      repoRoot,
      filePath ? ["stash", "show", "-p", stashRef, "--", filePath] : ["stash", "show", "-p", stashRef],
    );
  } else if (!filePath) {
    result = await runGitRepoAsync(repoRoot, staged ? ["diff", "--cached"] : ["diff"]);
  } else if (staged) {
    result = await runGitRepoAsync(repoRoot, ["diff", "--cached", "--", filePath]);
  } else {
    const abs = resolveUnderRepo(repoRoot, filePath);
    if (!abs) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    let isDir = looksLikeDirectoryPath(filePath);
    try {
      isDir = fs.statSync(abs).isDirectory();
    } catch {
      // Fall through — may still be an untracked path git knows about.
    }

    if (isDir) {
      const entries = listDirectoryEntries(abs);
      return NextResponse.json({
        path: filePath,
        staged,
        kind: "directory" as const,
        entries,
        raw: "",
        lines: [],
        empty: entries.length === 0,
        message:
          entries.length === 0
            ? "Empty untracked directory."
            : "Untracked directory — stage the whole folder, or select a file inside once it appears in Changes.",
      });
    }

    // Untracked file: show as /dev/null → file via `git diff --no-index`.
    // Never pass a directory here — git invents paths like `skills/push/null`.
    const status = await runGitRepoAsync(repoRoot, ["status", "--porcelain=v1", "--", filePath]);
    const line = (status.stdout || "").trim();
    if (line.startsWith("??")) {
      // Two path args, no `--` between them. Directory inputs are rejected above —
      // git otherwise invents bogus paths like `skills/push/null` from `/dev/null`.
      result = await runGitRepoAsync(repoRoot, ["diff", "--no-index", "/dev/null", filePath]);
      // git diff --no-index returns 1 when files differ — treat as success
      if (result.status === 1 && result.stdout) result = { ...result, status: 0 };
    } else {
      result = await runGitRepoAsync(repoRoot, ["diff", "--", filePath]);
    }
  }

  if (result.status !== 0 && !(result.stdout || "").trim()) {
    return gitFail(result, "Diff failed");
  }

  const raw = result.stdout || "";
  return NextResponse.json({
    path: filePath,
    staged,
    kind: "file" as const,
    raw,
    lines: parseUnifiedDiff(raw),
    empty: !raw.trim(),
  });
}
