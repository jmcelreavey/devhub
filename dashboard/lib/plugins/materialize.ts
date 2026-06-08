/**
 * Tier-2 materialiser: copies a plugin's dashboard module into the core dashboard tree at
 * the same relative paths (so the plugin's `@/lib`, `@/components` imports resolve
 * unchanged), then git-ignores those paths via a managed block. Next.js compiles the
 * copies as if they were core files.
 *
 * Safety: paths must stay inside the plugin's dashboard root and the core dashboard;
 * a path that is git-tracked in core is refused (never clobber core-owned files).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { listEnabledPlugins } from "./registry";
import type { RegisteredPlugin } from "./types";

export const EXCLUDE_BEGIN = "# >>> devhub-plugins (generated — do not edit) >>>";
export const EXCLUDE_END = "# <<< devhub-plugins <<<";

/**
 * Machine-local git exclude file (.git/info/exclude). Materialised plugin paths are
 * per-machine (depend on which plugins are registered), so their ignore rules must NOT
 * be committed — `.git/info/exclude` is the correct home. Returns null outside a repo.
 */
export function gitExcludePath(repoRoot: string): string | null {
  const res = spawnSync("git", ["-C", repoRoot, "rev-parse", "--git-path", "info/exclude"], {
    encoding: "utf-8",
  });
  if (res.status !== 0) return null;
  const p = res.stdout.trim();
  if (!p) return null;
  return path.isAbsolute(p) ? p : path.join(repoRoot, p);
}

export interface MaterializeEntry {
  plugin: string;
  /** absolute source inside the plugin */
  from: string;
  /** absolute destination inside core dashboard */
  to: string;
  /** dashboard-relative path (used for .gitignore + collision checks) */
  rel: string;
}

export interface MaterializePlan {
  entries: MaterializeEntry[];
  errors: string[];
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Pure: compute what each enabled plugin's dashboard contribution maps to. */
export function planDashboardMaterialization(
  plugins: RegisteredPlugin[],
  coreDashboardDir: string,
): MaterializePlan {
  const entries: MaterializeEntry[] = [];
  const errors: string[] = [];
  const claimed = new Set<string>();
  const coreDash = path.resolve(coreDashboardDir);

  for (const plugin of plugins) {
    const dash = plugin.manifest.dashboard;
    if (!dash) continue;
    const pluginDashRoot = path.resolve(plugin.path, dash.root);

    for (const rel of dash.paths) {
      const from = path.resolve(pluginDashRoot, rel);
      const to = path.resolve(coreDash, rel);
      const relNorm = path.relative(coreDash, to);

      if (!isInside(pluginDashRoot, from)) {
        errors.push(`[${plugin.name}] path escapes plugin dashboard root: ${rel}`);
        continue;
      }
      if (!isInside(coreDash, to)) {
        errors.push(`[${plugin.name}] path escapes core dashboard: ${rel}`);
        continue;
      }
      if (!fs.existsSync(from)) {
        errors.push(`[${plugin.name}] missing source: ${rel}`);
        continue;
      }
      if (claimed.has(relNorm)) {
        errors.push(`[${plugin.name}] path already claimed by another plugin: ${rel}`);
        continue;
      }
      claimed.add(relNorm);
      entries.push({ plugin: plugin.name, from, to, rel: relNorm });
    }
  }

  return { entries, errors };
}

/** True if a dashboard-relative path has any git-tracked files in core (would collide). */
function isGitTracked(coreDashboardDir: string, rel: string): boolean {
  const res = spawnSync("git", ["ls-files", "--", rel], {
    cwd: coreDashboardDir,
    encoding: "utf-8",
  });
  return res.status === 0 && res.stdout.trim().length > 0;
}

/** Managed patterns (repo-root-relative, no leading slash) currently in the exclude file. */
function readManagedPatterns(excludePath: string): string[] {
  if (!fs.existsSync(excludePath)) return [];
  const text = fs.readFileSync(excludePath, "utf-8");
  const start = text.indexOf(EXCLUDE_BEGIN);
  const end = text.indexOf(EXCLUDE_END);
  if (start === -1 || end === -1 || end < start) return [];
  return text
    .slice(start + EXCLUDE_BEGIN.length, end)
    .split("\n")
    .map((l) => l.trim().replace(/^\//, ""))
    .filter((l) => l && !l.startsWith("#"));
}

function writeManagedBlock(excludePath: string, patterns: string[]): void {
  const block =
    patterns.length === 0
      ? ""
      : `${EXCLUDE_BEGIN}\n${patterns.map((p) => `/${p}`).join("\n")}\n${EXCLUDE_END}\n`;
  let text = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, "utf-8") : "";
  const start = text.indexOf(EXCLUDE_BEGIN);
  const end = text.indexOf(EXCLUDE_END);
  if (start !== -1 && end !== -1 && end > start) {
    const after = text.slice(end + EXCLUDE_END.length).replace(/^\n/, "");
    text = text.slice(0, start) + block + after;
  } else if (block) {
    text = text.replace(/\s*$/, "\n") + "\n" + block;
  }
  fs.mkdirSync(path.dirname(excludePath), { recursive: true });
  fs.writeFileSync(excludePath, text);
}

export interface MaterializeOptions {
  repoRoot: string;
  emit: (line: string) => void;
  dryRun?: boolean;
}

/** Copy enabled plugins' dashboard modules into core, manage .gitignore, prune stale. */
export function materializePlugins(opts: MaterializeOptions): number {
  const { repoRoot, emit, dryRun } = opts;
  const coreDash = path.join(repoRoot, "dashboard");

  const plugins = listEnabledPlugins(undefined, emit);
  const plan = planDashboardMaterialization(plugins, coreDash);

  for (const err of plan.errors) emit(`ERROR: ${err}`);
  if (plan.errors.length > 0) return 1;

  // Refuse to overwrite core-owned (git-tracked) paths.
  const safe = plan.entries.filter((e) => {
    if (isGitTracked(coreDash, e.rel)) {
      emit(`SKIP (git-tracked in core, would clobber): ${e.rel}`);
      return false;
    }
    return true;
  });

  const excludePath = gitExcludePath(repoRoot);
  if (!excludePath) {
    // No git exclude (e.g. building from a tarball). Only an error if we actually had
    // dashboard paths to materialise; otherwise there's nothing to do.
    if (safe.length === 0) return 0;
    emit("ERROR: cannot resolve .git/info/exclude (not a git repo?)");
    return 1;
  }

  // Patterns are repo-root-relative (e.g. "dashboard/app/ops") for .git/info/exclude.
  const newPatterns = safe.map((e) => `dashboard/${e.rel}`).sort();
  const oldPatterns = readManagedPatterns(excludePath);
  const stale = oldPatterns.filter((p) => !newPatterns.includes(p));

  emit(
    `Materialising ${safe.length} dashboard path(s) from ${plugins.filter((p) => p.manifest.dashboard).length} plugin(s)` +
      (stale.length ? `; pruning ${stale.length} stale` : "") +
      (dryRun ? " (DRY RUN)" : ""),
  );

  if (dryRun) {
    for (const e of safe) emit(`  WOULD: ${e.plugin} → dashboard/${e.rel}`);
    for (const p of stale) emit(`  WOULD PRUNE: ${p}`);
    return 0;
  }

  // Prune stale materialised paths first.
  for (const pat of stale) {
    fs.rmSync(path.join(repoRoot, pat), { recursive: true, force: true });
    emit(`  PRUNED: ${pat}`);
  }

  for (const e of safe) {
    fs.rmSync(e.to, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(e.to), { recursive: true });
    fs.cpSync(e.from, e.to, { recursive: true });
    emit(`  ${e.plugin} → dashboard/${e.rel}`);
  }

  writeManagedBlock(excludePath, newPatterns);
  return 0;
}
