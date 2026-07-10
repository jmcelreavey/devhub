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

export async function POST(req: NextRequest, { params }: Params) {
  const { name } = await params;
  if (!/^[a-zA-Z0-9_.\-]+$/.test(name) || name.includes("..")) {
    return NextResponse.json({ error: "Invalid repo name" }, { status: 400 });
  }
  const repoPath = path.join(getReposScanDir(), name);
  if (!fs.existsSync(path.join(repoPath, ".git"))) {
    return NextResponse.json({ error: "Repo not found" }, { status: 404 });
  }

  const body = req.headers.get("content-type")?.includes("application/json")
    ? ((await req.json().catch(() => ({}))) as { path?: unknown; line?: unknown })
    : {};

  const relativePath = typeof body.path === "string" && body.path.trim() ? body.path.trim() : "";
  if (relativePath.startsWith("/") || relativePath.includes("..")) {
    return NextResponse.json({ error: "Invalid repo path" }, { status: 400 });
  }
  const targetPath = relativePath ? path.resolve(repoPath, relativePath) : repoPath;
  if (targetPath !== repoPath && !targetPath.startsWith(`${repoPath}${path.sep}`)) {
    return NextResponse.json({ error: "Invalid repo path" }, { status: 400 });
  }
  if (!fs.existsSync(targetPath)) {
    return NextResponse.json({ error: "Repo path not found" }, { status: 404 });
  }

  const line = typeof body.line === "number" && Number.isInteger(body.line) && body.line > 0 ? body.line : undefined;

  const cursorBin = resolveCursor();
  if (!cursorBin) {
    return NextResponse.json({ error: "Cursor CLI not found on PATH" }, { status: 503 });
  }

  const cursorArgs = line ? ["-g", `${targetPath}:${line}`] : [targetPath];
  const child = spawn(cursorBin, cursorArgs, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  return NextResponse.json({ ok: true, path: targetPath });
}
