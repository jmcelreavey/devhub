/**
 * Turn declared dependencies across the estate into things worth acting on.
 *
 * ## What this answers, and what it does not
 *
 * This is **offline**. It compares your repos against each other, not against
 * the npm registry, so it answers *"where has my estate diverged from itself"*
 * — you are on React 17 in four repos and React 19 in three, and the gap is
 * yours to close or to decide about.
 *
 * It does **not** answer "is there a newer release upstream". That needs the
 * registry, and the honest reason it is not here yet is scope, not principle:
 * the offline half is immediately useful, has no network dependency to degrade,
 * and is fully testable. A registry enrichment slots in as another advisory
 * kind against the same `Advisory` shape.
 *
 * ## Why divergence rather than staleness
 *
 * Staleness needs an external "current" to measure against. Divergence needs
 * nothing outside your own repos, and for a 52-repo estate it is the more
 * actionable signal anyway: the version you already upgraded somewhere is
 * proof the upgrade is possible, and names the repo to copy it from.
 *
 * ## Noise control
 *
 * A dependency in one repo cannot diverge from anything, and two repos
 * disagreeing about a dev-only formatter is not news. Both are filtered here
 * rather than in the UI, so the API's counts mean the same thing the page shows
 * and the acknowledgement watermark counts the same population.
 */
import type { RepoManifest } from "./manifests";
import { compareMajorLines, majorDistance, majorLine, type MajorLine } from "./versions";

export interface LineUsage {
  line: MajorLine;
  repos: string[];
}

export interface Advisory {
  /** Stable across scans so an acknowledgement survives — the package name. */
  id: string;
  name: string;
  /** Newest major line in use anywhere, the natural convergence target. */
  latestLine: MajorLine;
  /** Every line in use, newest first. */
  lines: LineUsage[];
  /** Repos not on `latestLine` — the work, if you decide to do it. */
  behindRepos: string[];
  /** Major steps between the oldest and newest line in use. */
  spread: number;
  /** True when every declaring manifest is a devDependency. */
  devOnly: boolean;
  /** Total repos declaring it, and the acknowledgement watermark. */
  repoCount: number;
}

export interface AnalyseOptions {
  /**
   * Ignore packages used in fewer than this many repos. Two is the floor by
   * definition — one repo cannot disagree with itself.
   *
   * The default is 3, not 2, and that is a noise decision made from real data:
   * at 2 the estate produced 112 rows, which is precisely the unreadable wall
   * this radar exists to avoid. Two repos disagreeing is usually two unrelated
   * projects, not an estate problem.
   */
  minRepos?: number;
  /**
   * Ignore rows where only one repo is behind. Default true.
   *
   * One straggler is a to-do, not a pattern, and it is the single biggest
   * source of volume.
   */
  minBehind?: number;
  /** Ignore dev-only divergence. Off by default; a lint config drifting is real, just quieter. */
  prodOnly?: boolean;
}

interface Accumulated {
  name: string;
  /** line → repo names */
  byLine: Map<MajorLine, Set<string>>;
  repos: Set<string>;
  prodRepos: Set<string>;
  /** Repos declaring it with a range that names no single line. */
  unpinnedRepos: Set<string>;
}

export function analyseManifests(
  manifests: RepoManifest[],
  options: AnalyseOptions = {},
): Advisory[] {
  const minRepos = Math.max(2, options.minRepos ?? 3);
  const minBehind = Math.max(1, options.minBehind ?? 2);
  const packages = new Map<string, Accumulated>();

  for (const manifest of manifests) {
    for (const dep of manifest.dependencies) {
      let entry = packages.get(dep.name);
      if (!entry) {
        entry = {
          name: dep.name,
          byLine: new Map(),
          repos: new Set(),
          prodRepos: new Set(),
          unpinnedRepos: new Set(),
        };
        packages.set(dep.name, entry);
      }

      entry.repos.add(manifest.repoName);
      if (dep.kind === "prod") entry.prodRepos.add(manifest.repoName);

      const line = majorLine(dep.range);
      if (line === null) {
        entry.unpinnedRepos.add(manifest.repoName);
        continue;
      }
      const repos = entry.byLine.get(line) ?? new Set<string>();
      repos.add(manifest.repoName);
      entry.byLine.set(line, repos);
    }
  }

  const advisories: Advisory[] = [];

  for (const entry of packages.values()) {
    // A single line in use is alignment, which is the desired state and not
    // worth a row. Zero lines means every declaration was a workspace link or
    // wildcard — unresolvable, not divergent.
    if (entry.byLine.size < 2) continue;
    if (entry.repos.size < minRepos) continue;

    const devOnly = entry.prodRepos.size === 0;
    if (options.prodOnly && devOnly) continue;

    const lines: LineUsage[] = [...entry.byLine.entries()]
      .map(([line, repos]) => ({ line, repos: [...repos].sort() }))
      .sort((a, b) => compareMajorLines(a.line, b.line));

    const latestLine = lines[0].line;
    const oldestLine = lines[lines.length - 1].line;

    // Deduplicate, and exclude anything already on the newest line.
    //
    // Both matter for monorepos, and both were wrong first time round. A repo
    // with several manifests appears once per line it uses, so a plain flatMap
    // counted `devhub` twice — once for the root package.json and once for
    // dashboard/ — and the UI rendered "@types/node: 16 of 16 repos behind",
    // which is impossible on its face since one repo was on the latest line.
    //
    // A repo with *any* manifest on the newest line is not "behind": it has
    // already done the upgrade somewhere, so it is a place to copy from rather
    // than work to schedule. Its lagging package is still visible when the row
    // is expanded.
    const latestRepos = new Set(lines[0].repos);
    const behindRepos = [
      ...new Set(
        lines
          .slice(1)
          .flatMap((usage) => usage.repos)
          .filter((repo) => !latestRepos.has(repo)),
      ),
    ].sort();

    advisories.push({
      id: entry.name,
      name: entry.name,
      latestLine,
      lines,
      behindRepos,
      spread: majorDistance(oldestLine, latestLine),
      devOnly,
      repoCount: entry.repos.size,
    });
  }

  // Rank by how much of the estate is inconsistent, NOT by raw major distance.
  //
  // Sorting by `spread` was the first attempt and it was wrong on real data.
  // Major numbers are not comparable across packages: `googleapis` ships past
  // v170, so a routine lag scores spread=110 and dominates the list, while
  // `expo-*` packages compare across SDK eras where 0.30 and 57 are not even
  // the same numbering scheme. Both are noise with enormous scores. Meanwhile
  // `@types/node` — 16 repos across 6 different lines, an actual estate problem
  // — sorted ninth.
  //
  // Repos-behind is the honest measure of "how inconsistent is this, and how
  // much work is it", and distinct line count breaks ties toward genuine
  // fragmentation. `spread` is kept on the row as context but no longer steers
  // the ordering.
  return advisories
    .filter((a) => a.behindRepos.length >= minBehind)
    .sort(
      (a, b) =>
        b.behindRepos.length - a.behindRepos.length ||
        b.lines.length - a.lines.length ||
        a.name.localeCompare(b.name),
    );
}
