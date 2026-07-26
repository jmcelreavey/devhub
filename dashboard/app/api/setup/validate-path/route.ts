import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

interface CheckResult {
  ok: boolean;
  resolved: string;
  message: string;
  isGitRepo?: boolean;
  hasNotesIndex?: boolean;
  repoCount?: number;
}

/** Direct children that are git repositories. One level; see setup/status. */
function countGitRepos(dir: string): number {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .filter((e) => fs.existsSync(path.join(dir, e.name, ".git"))).length;
  } catch {
    return 0;
  }
}

function expandHome(p: string): string {
  if (!p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function check(rawPath: string, kind: "repoRoot" | "notesDir" | "reposDir"): CheckResult {
  if (!rawPath || !rawPath.trim()) {
    return { ok: false, resolved: "", message: "Path is required" };
  }
  const expanded = expandHome(rawPath.trim());
  if (!path.isAbsolute(expanded)) {
    return { ok: false, resolved: expanded, message: "Path must be absolute" };
  }
  const resolved = path.resolve(expanded);

  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return { ok: false, resolved, message: "Path does not exist" };
  }
  if (!stat.isDirectory()) {
    return { ok: false, resolved, message: "Path is not a directory" };
  }

  if (kind === "reposDir") {
    // An empty folder is a valid answer: someone here for notes and tasks has
    // no repositories yet, and telling them their choice is wrong would be
    // wrong. The count is information, not a gate.
    const repoCount = countGitRepos(resolved);
    return {
      ok: true,
      resolved,
      repoCount,
      message:
        repoCount === 0
          ? "No Git repositories here yet — that's fine, you can change this later"
          : `Found ${repoCount} Git ${repoCount === 1 ? "repository" : "repositories"}`,
    };
  }

  if (kind === "repoRoot") {
    const isGitRepo = fs.existsSync(path.join(resolved, ".git"));
    return {
      ok: true,
      resolved,
      isGitRepo,
      message: isGitRepo
        ? "Looks like a git repo"
        : "Directory exists (no .git found — that's fine if intentional)",
    };
  }

  const hasNotesIndex = fs.existsSync(path.join(resolved, "index.json"));
  return {
    ok: true,
    resolved,
    hasNotesIndex,
    message: hasNotesIndex
      ? "Notes directory looks initialized"
      : "Directory exists (no index.json yet — devhub will create it on first write)",
  };
}

const ValidatePathSchema = z.object({
  repoRoot: z.string().optional(),
  notesDir: z.string().optional(),
  reposDir: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, ValidatePathSchema);
  if (!parsed.ok) return parsed.response;
  const { repoRoot, notesDir, reposDir } = parsed.data;
  return NextResponse.json({
    repoRoot: repoRoot !== undefined ? check(repoRoot, "repoRoot") : null,
    notesDir: notesDir !== undefined ? check(notesDir, "notesDir") : null,
    reposDir: reposDir !== undefined ? check(reposDir, "reposDir") : null,
  });
}
