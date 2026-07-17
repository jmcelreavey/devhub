import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";
import { getReposScanDir } from "@/lib/repos";
import { revealPath, revealPathLabel } from "@/lib/reveal-path";

type Params = { params: Promise<{ name: string }> };

/** Open a local repo folder in Finder / Explorer / the system file manager. */
export async function POST(_req: Request, { params }: Params) {
  const { name } = await params;
  if (!/^[a-zA-Z0-9_.\-]+$/.test(name) || name.includes("..")) {
    return NextResponse.json({ error: "Invalid repo name" }, { status: 400 });
  }
  const scanDir = getReposScanDir();
  const repoPath = path.resolve(path.join(scanDir, name));
  if (path.dirname(repoPath) !== path.resolve(scanDir) || !fs.existsSync(repoPath)) {
    return NextResponse.json({ error: "Unknown repo" }, { status: 404 });
  }
  try {
    revealPath(repoPath);
    return NextResponse.json({ ok: true, path: repoPath, label: revealPathLabel() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
