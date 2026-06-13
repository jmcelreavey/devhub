import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { getReposScanDir } from "@/lib/repos";

type Params = { params: Promise<{ name: string }> };

/** Open a local repo in GitKraken (macOS `open -a`; falls back to the CLI). */
export async function POST(_req: Request, { params }: Params) {
  const { name } = await params;
  const scanDir = getReposScanDir();
  const repoPath = path.resolve(path.join(scanDir, name));
  if (path.dirname(repoPath) !== path.resolve(scanDir) || !fs.existsSync(repoPath)) {
    return NextResponse.json({ error: "Unknown repo" }, { status: 404 });
  }
  try {
    if (process.platform === "darwin") {
      spawn("open", ["-a", "GitKraken", repoPath], { detached: true, stdio: "ignore" }).unref();
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
