import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { runGitRepoAsync } from "@/lib/git/repo-local";

/** Includes staged, unstaged and untracked work; stores hashes, never file contents. */
export async function worktreeFingerprint(cwd: string): Promise<string> {
  const hash = createHash("sha256");
  for (const args of [["rev-parse", "HEAD"], ["diff", "--binary", "--no-ext-diff", "--no-textconv", "HEAD"], ["diff", "--cached", "--binary", "--no-ext-diff", "--no-textconv"]]) {
    const result = await runGitRepoAsync(cwd, args);
    if (result.status !== 0) throw new Error(result.stderr || "Cannot inspect the worktree");
    hash.update(JSON.stringify(args)).update(result.stdout);
  }
  const untracked = await runGitRepoAsync(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]);
  if (untracked.status !== 0) throw new Error(untracked.stderr);
  let bytes = 0;
  for (const name of untracked.stdout.split("\0").filter(Boolean).sort()) {
    const file = path.resolve(cwd, name);
    if (!file.startsWith(path.resolve(cwd) + path.sep)) throw new Error("File escaped the worktree");
    const stat = await fs.lstat(file);
    hash.update(name);
    if (stat.isSymbolicLink()) {
      hash.update(await fs.readlink(file));
      continue;
    }
    bytes += stat.size;
    if (!stat.isFile() || bytes > 50 * 1024 * 1024) throw new Error("Untracked files are too large to verify. Ignore generated files first.");
    hash.update(await fs.readFile(file));
  }
  return hash.digest("hex");
}
