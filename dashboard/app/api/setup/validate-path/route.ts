import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const dynamic = "force-dynamic";

interface CheckResult {
  ok: boolean;
  resolved: string;
  message: string;
  isGitRepo?: boolean;
  hasNotesIndex?: boolean;
}

function expandHome(p: string): string {
  if (!p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function check(rawPath: string, kind: "repoRoot" | "notesDir"): CheckResult {
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

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { repoRoot?: string; notesDir?: string };
  return NextResponse.json({
    repoRoot: body.repoRoot !== undefined ? check(body.repoRoot, "repoRoot") : null,
    notesDir: body.notesDir !== undefined ? check(body.notesDir, "notesDir") : null,
  });
}
