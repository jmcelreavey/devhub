/**
 * What every repo declares it depends on, and at what version.
 *
 * ## Why not reuse the capability scan
 *
 * `lib/capability` already opens every `package.json`, but it only asks "does
 * this repo use Redis" and throws the versions away. Release Radar asks the
 * opposite question — *which* version, and how far apart are they — so the
 * data it needs was never retained. Widening `RepoScan` to carry full
 * dependency maps would inflate every snapshot on disk for a feature that reads
 * them once, so this reads manifests directly instead.
 *
 * ## Direct dependencies only
 *
 * Lockfiles are deliberately not parsed. A lockfile answers "what is installed",
 * which is a fact about a checkout rather than a decision anybody made — and it
 * drags in thousands of transitive packages nobody chose. The question worth
 * surfacing is "what have I asked for, and does it disagree with what I asked
 * for elsewhere", and that lives in `package.json`.
 *
 * `peerDependencies` are excluded too: a peer range is a compatibility
 * statement about someone else's tree, not a version this repo runs.
 */
import fs from "node:fs";
import path from "node:path";

export type DependencyKind = "prod" | "dev" | "optional";

export interface DeclaredDependency {
  name: string;
  /** The raw range as written, e.g. `^18.2.0`, `~4.1`, `workspace:*`. */
  range: string;
  kind: DependencyKind;
}

export interface RepoManifest {
  repoName: string;
  manifestPath: string;
  dependencies: DeclaredDependency[];
}

const DEPENDENCY_FIELDS: Array<[string, DependencyKind]> = [
  ["dependencies", "prod"],
  ["devDependencies", "dev"],
  ["optionalDependencies", "optional"],
];

/**
 * Directories never worth descending into.
 *
 * `node_modules` is the load-bearing one: without it a single repo contributes
 * thousands of vendored manifests and the scan reports the estate's transitive
 * closure as if the user had chosen it.
 */
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "out", "coverage",
  "vendor", ".venv", "venv", "__pycache__", ".turbo", ".cache",
]);

/**
 * How deep to look for manifests within one repo.
 *
 * Depth 3 reaches a monorepo's `packages/<name>/package.json` without walking
 * arbitrarily deep trees. Beyond that the returns are nil and the cost is every
 * fixture and example directory in the estate.
 */
const MAX_DEPTH = 3;

export function findManifestFiles(repoDir: string, maxDepth = MAX_DEPTH): string[] {
  const found: string[] = [];

  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory is not worth failing a whole scan over
    }

    for (const entry of entries) {
      if (entry.isFile() && entry.name === "package.json") {
        found.push(path.join(dir, entry.name));
        continue;
      }
      if (!entry.isDirectory() || depth >= maxDepth) continue;
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      walk(path.join(dir, entry.name), depth + 1);
    }
  };

  walk(repoDir, 0);
  return found.sort();
}

export function readManifest(file: string, repoName: string): RepoManifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null; // a malformed package.json is the repo's problem, not a scan failure
  }
  if (!parsed || typeof parsed !== "object") return null;

  const record = parsed as Record<string, unknown>;
  const dependencies: DeclaredDependency[] = [];

  for (const [field, kind] of DEPENDENCY_FIELDS) {
    const group = record[field];
    if (!group || typeof group !== "object" || Array.isArray(group)) continue;
    for (const [name, range] of Object.entries(group as Record<string, unknown>)) {
      if (typeof range !== "string") continue;
      dependencies.push({ name, range, kind });
    }
  }

  if (dependencies.length === 0) return null;
  return { repoName, manifestPath: file, dependencies };
}

export function readRepoManifests(repoDir: string, repoName: string): RepoManifest[] {
  return findManifestFiles(repoDir)
    .map((file) => readManifest(file, repoName))
    .filter((m): m is RepoManifest => m !== null);
}
