import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";
import { getReposScanDir } from "@/lib/repos";
import { openPathInCursor } from "@/lib/cursor-open";

type Params = { params: Promise<{ name: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const { name } = await params;
  if (!/^[a-zA-Z0-9_.\-]+$/.test(name) || name.includes("..")) {
    return NextResponse.json({ error: "Invalid repo name" }, { status: 400 });
  }
  const repoPath = path.join(getReposScanDir(), name);
  if (!fs.existsSync(path.join(repoPath, ".git"))) {
    return NextResponse.json({ error: "Repo not found" }, { status: 404 });
  }

  const error = openPathInCursor(repoPath);
  if (error) return NextResponse.json({ error }, { status: 503 });

  return NextResponse.json({ ok: true, path: repoPath });
}
