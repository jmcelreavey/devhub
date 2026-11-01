import fs from "node:fs";
import { repoApps } from "../../../../../../../packages/shared/actions/repos";
import { httpAction } from "../../../../lib/actions/http";
import { withErrorHandler } from "../../../../lib/api-utils";
import { execExternal } from "../../../../lib/exec-external";
import { revealPathLabel } from "../../../../lib/reveal-path";

/**
 * Which repo-opening apps exist on this machine. Cached for the process
 * lifetime — installs don't change mid-session, and the checks shell out.
 */
let cached: { gitkraken: boolean; docker: boolean; revealLabel: string } | null = null;

async function hasBinary(name: string): Promise<boolean> {
  try {
    await execExternal("which", [name], { timeoutMs: 3_000 });
    return true;
  } catch {
    return false;
  }
}

export const GET = withErrorHandler(async (req: Request) => httpAction(repoApps, {
  input: () => ({}),
  context: () => ({ read: readRepoApps }),
  response: (result) => Response.json(result),
})(req), "repos-apps");

async function readRepoApps() {
  if (!cached) {
    cached = {
      gitkraken:
        fs.existsSync("/Applications/GitKraken.app") ||
        fs.existsSync(`${process.env.HOME}/Applications/GitKraken.app`),
      docker: await hasBinary("docker"),
      revealLabel: revealPathLabel(),
    };
  }
  return cached;
}
