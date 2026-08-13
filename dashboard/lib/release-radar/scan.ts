/**
 * Read every local repo's manifests and report where the estate disagrees.
 *
 * Kept separate from the API route so the whole pipeline is callable from a
 * test, a script, or an MCP tool without going through HTTP — the capability
 * scan learned that lesson already.
 */
import fs from "node:fs";
import path from "node:path";
import { getReposScanDir } from "@/lib/repos";
import { analyseManifests, type Advisory, type AnalyseOptions } from "./analyse";
import { readRepoManifests, type RepoManifest } from "./manifests";

export interface ReleaseRadarResult {
  advisories: Advisory[];
  /** Repos that contributed at least one manifest. */
  reposWithManifests: number;
  reposScanned: number;
  manifestsRead: number;
  scannedAt: string;
}

/**
 * List local repo directories.
 *
 * Deliberately not `listRepos()`. That helper enriches every entry with branch,
 * dirty count and unpushed count, which is 50+ git invocations — a real cost for
 * a panel that only needs to know where the working trees are. This reads the
 * scan directory directly and does no git work at all.
 */
export function localRepoDirs(): Array<{ name: string; path: string }> {
  const scanDir = getReposScanDir();
  if (!fs.existsSync(scanDir)) return [];

  return fs
    .readdirSync(scanDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(scanDir, e.name, ".git")))
    .map((e) => ({ name: e.name, path: path.join(scanDir, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function collectManifests(): { manifests: RepoManifest[]; reposScanned: number } {
  const repos = localRepoDirs();
  const manifests: RepoManifest[] = [];

  for (const repo of repos) {
    manifests.push(...readRepoManifests(repo.path, repo.name));
  }

  return { manifests, reposScanned: repos.length };
}

export function runReleaseRadar(options: AnalyseOptions = {}): ReleaseRadarResult {
  const { manifests, reposScanned } = collectManifests();
  return {
    advisories: analyseManifests(manifests, options),
    reposWithManifests: new Set(manifests.map((m) => m.repoName)).size,
    reposScanned,
    manifestsRead: manifests.length,
    scannedAt: new Date().toISOString(),
  };
}
