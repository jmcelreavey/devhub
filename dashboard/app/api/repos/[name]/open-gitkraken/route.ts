import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { getReposScanDir } from "@/lib/repos";

type Params = { params: Promise<{ name: string }> };

/** Open a local repo in GitKraken via the gitkraken:// URL scheme (macOS)
 *  or the `-p` CLI flag (Linux). The URL scheme routes through the OS handler
 *  so it works whether GitKraken is already running or not. */
export async function POST(_req: Request, { params }: Params) {
  const { name } = await params;
  const scanDir = getReposScanDir();
  const repoPath = path.resolve(path.join(scanDir, name));
  if (path.dirname(repoPath) !== path.resolve(scanDir) || !fs.existsSync(repoPath)) {
    return NextResponse.json({ error: "Unknown repo" }, { status: 404 });
  }
  try {
    if (process.platform === "darwin") {
      const uri = `gitkraken://repo${encodeURI(repoPath)}`;
      spawn("open", [uri], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("gitkraken", ["-p", repoPath], { detached: true, stdio: "ignore" }).unref();
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
