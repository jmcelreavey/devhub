import { execExternal } from "../exec-external";

/** Run a Git query and surface command failures to the caller. */
export async function gitLog(repoPath: string, args: string[], timeoutMs = 6_000): Promise<string> {
  try {
    const { stdout } = await execExternal("git", ["-C", repoPath, ...args], { timeoutMs });
    return stdout.trim();
  } catch (error) {
    // `git config --get` exits 1 when a local repository has no origin.
    if (args.length === 3 && args[0] === "config" && args[1] === "--get" && args[2] === "remote.origin.url"
      && (error as { code?: unknown; stderr?: unknown })?.code === 1
      && (error as { stderr?: unknown }).stderr === "") return "";
    throw error;
  }
}
