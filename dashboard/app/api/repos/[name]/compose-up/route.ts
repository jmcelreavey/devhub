import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { getReposScanDir } from "@/lib/repos";

type Params = { params: Promise<{ name: string }> };

/**
 * The deliberately boring docker button: `docker compose up -d` in the repo
 * root, nothing fancier. Repos needing env juggling or profiles should use
 * the terminal — this is for the happy path.
 */
export async function POST(_req: Request, { params }: Params) {
  const { name } = await params;
  const scanDir = getReposScanDir();
  const repoPath = path.resolve(path.join(scanDir, name));
  if (path.dirname(repoPath) !== path.resolve(scanDir) || !fs.existsSync(repoPath)) {
    return NextResponse.json({ error: "Unknown repo" }, { status: 404 });
  }

  return new Promise<NextResponse>((resolve) => {
    const child = spawn("docker", ["compose", "up", "-d"], {
      cwd: repoPath,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => {
      child.kill();
      resolve(
        NextResponse.json(
          { error: "docker compose up timed out after 120s", output: out.slice(-2000) },
          { status: 504 },
        ),
      );
    }, 120_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(NextResponse.json({ ok: true, output: out.slice(-2000) }));
      } else {
        resolve(
          NextResponse.json(
            { error: `docker compose exited with code ${code}`, output: out.slice(-2000) },
            { status: 500 },
          ),
        );
      }
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve(NextResponse.json({ error: err.message }, { status: 500 }));
    });
  });
}
