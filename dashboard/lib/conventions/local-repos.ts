/**
 * Which GitHub repos are cloned locally — remotes only.
 *
 * `listRepos()` is the card-grade scan: it runs `git status` and `git worktree
 * list` in every clone, which is right for the Repos page and far too much for
 * something a review hook or a polled endpoint calls. This reads each clone's
 * `.git/config` and nothing else.
 */
import fs from "node:fs";
import path from "node:path";
import { getGithubFullNameForLocalRepo, getReposScanDir } from "@/lib/repos";

export interface LocalGithubRepo {
  name: string;
  fullName: string;
}

export function localGithubRepos(): LocalGithubRepo[] {
  const scanDir = getReposScanDir();
  if (!fs.existsSync(scanDir)) return [];
  const out: LocalGithubRepo[] = [];
  for (const entry of fs.readdirSync(scanDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(scanDir, entry.name);
    if (!fs.existsSync(path.join(dir, ".git"))) continue;
    const fullName = getGithubFullNameForLocalRepo(dir);
    if (fullName) out.push({ name: entry.name, fullName });
  }
  return out;
}

/** `owner/repo` for a clone folder name, or null. The name is only ever a direct child of the scan dir. */
export function githubFullNameForLocalName(name: string): string | null {
  if (!/^[A-Za-z0-9_.-]+$/.test(name) || name.includes("..") || name.startsWith("-")) return null;
  const dir = path.join(getReposScanDir(), name);
  if (!fs.existsSync(path.join(dir, ".git"))) return null;
  return getGithubFullNameForLocalRepo(dir);
}
