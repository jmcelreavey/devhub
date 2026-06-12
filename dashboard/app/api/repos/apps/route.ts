import { NextResponse } from "next/server";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { withErrorHandler } from "@/lib/api-utils";

/**
 * Which repo-opening apps exist on this machine. Cached for the process
 * lifetime — installs don't change mid-session, and the checks shell out.
 */
let cached: { gitkraken: boolean; docker: boolean } | null = null;

function hasBinary(name: string): boolean {
  const res = spawnSync("which", [name], { stdio: ["ignore", "pipe", "ignore"], timeout: 3_000 });
  return res.status === 0;
}

export const GET = withErrorHandler(async () => {
  if (!cached) {
    cached = {
      gitkraken:
        fs.existsSync("/Applications/GitKraken.app") ||
        fs.existsSync(`${process.env.HOME}/Applications/GitKraken.app`),
      docker: hasBinary("docker"),
    };
  }
  return NextResponse.json(cached);
}, "repos-apps");
