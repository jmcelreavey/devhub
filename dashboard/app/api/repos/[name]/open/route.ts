import { NextRequest, NextResponse } from "next/server";
import { execSync, spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { getReposScanDir } from "@/lib/repos";
import { EXTRA_PATH_SEGMENTS } from "@/lib/process-env";

type Params = { params: Promise<{ name: string }> };

let cachedCursorBin: string | null = null;

function resolveCursor(): string | null {
  if (cachedCursorBin !== null) return cachedCursorBin;
  const shellBin = process.env.SHELL || "/bin/sh";
  try {
    const resolved = execSync(`${shellBin} -l -c 'which cursor'`, {
      encoding: "utf8",
      timeout: 5_000,
    }).trim();
    if (resolved && fs.existsSync(resolved)) {
      cachedCursorBin = resolved;
      return cachedCursorBin;
    }
  } catch { /* fall through */ }
  for (const dir of EXTRA_PATH_SEGMENTS) {
    const candidate = path.join(dir, "cursor");
    if (fs.existsSync(candidate)) {
      cachedCursorBin = candidate;
      return cachedCursorBin;
    }
  }
  cachedCursorBin = null;
  return null;
}

export async function POST(_req: NextRequest, { params }: Params) {
  const { name } = await params;
  if (!/^[a-zA-Z0-9_.\-]+$/.test(name) || name.includes("..")) {
    return NextResponse.json({ error: "Invalid repo name" }, { status: 400 });
  }
  const repoPath = path.join(getReposScanDir(), name);
  if (!fs.existsSync(path.join(repoPath, ".git"))) {
    return NextResponse.json({ error: "Repo not found" }, { status: 404 });
  }

  const cursorBin = resolveCursor();
  if (!cursorBin) {
    return NextResponse.json({ error: "Cursor CLI not found on PATH" }, { status: 503 });
  }

  const child = spawn(cursorBin, [repoPath], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  return NextResponse.json({ ok: true, path: repoPath });
}
