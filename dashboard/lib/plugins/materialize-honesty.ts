/**
 * Materialization honesty — detect when plugin-owned dashboard copies diverge
 * from plugin source (the classic "I edited bi-ops.ts in core and restart ate it" footgun).
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { gitExcludePath, EXCLUDE_BEGIN, EXCLUDE_END, planDashboardMaterialization } from "./materialize";
import { listEnabledPlugins } from "./registry";

export interface MaterializedDriftEntry {
  /** Repo-root-relative path, e.g. dashboard/lib/bi-ops.ts */
  path: string;
  plugin: string;
  /** Absolute plugin source path */
  pluginSource: string;
  reason: "diverged" | "missing-source" | "core-only-copy";
}

export interface MaterializeHonestyReport {
  ok: boolean;
  checked: number;
  drifts: MaterializedDriftEntry[];
  message: string | null;
}

function fileHash(abs: string): string | null {
  try {
    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return null;
    return createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
  } catch {
    return null;
  }
}

function walkFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (ent.name.startsWith(".")) continue;
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) walk(full);
      else out.push(full);
    }
  };
  if (fs.statSync(dir).isDirectory()) walk(dir);
  else out.push(dir);
  return out;
}

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

/** Compare materialised dashboard copies to their plugin sources. */
export function detectMaterializeDrift(repoRoot: string): MaterializeHonestyReport {
  const plugins = listEnabledPlugins();
  const coreDash = path.join(repoRoot, "dashboard");
  const plan = planDashboardMaterialization(plugins, coreDash);
  const drifts: MaterializedDriftEntry[] = [];
  let checked = 0;

  for (const entry of plan.entries) {
    const coreFiles = walkFiles(entry.to);
    for (const coreFile of coreFiles) {
      checked += 1;
      const relInside = path.relative(entry.to, coreFile);
      const pluginFile = path.join(entry.from, relInside);
      const repoRel = path.relative(repoRoot, coreFile);

      if (!fs.existsSync(pluginFile)) {
        drifts.push({
          path: repoRel,
          plugin: entry.plugin,
          pluginSource: entry.from,
          reason: "missing-source",
        });
        continue;
      }
      if (fs.statSync(pluginFile).isDirectory()) continue;
      const a = fileHash(coreFile);
      const b = fileHash(pluginFile);
      if (a && b && a !== b) {
        drifts.push({
          path: repoRel,
          plugin: entry.plugin,
          pluginSource: pluginFile,
          reason: "diverged",
        });
      }
    }
  }

  // Also flag managed exclude paths that exist but aren't in the current plan (orphans).
  const excludePath = gitExcludePath(repoRoot);
  if (excludePath) {
    const planned = new Set(plan.entries.map((e) => `dashboard/${e.rel}`));
    for (const pat of readManagedPatterns(excludePath)) {
      if (planned.has(pat)) continue;
      const abs = path.join(repoRoot, pat);
      if (fs.existsSync(abs)) {
        drifts.push({
          path: pat,
          plugin: "?",
          pluginSource: "",
          reason: "core-only-copy",
        });
      }
    }
  }

  const ok = drifts.length === 0;
  let message: string | null = null;
  if (!ok) {
    const sample = drifts.slice(0, 3).map((d) => d.path).join(", ");
    message =
      `Edited plugin-owned file(s) in core (${sample}` +
      `${drifts.length > 3 ? `, +${drifts.length - 3} more` : ""}). ` +
      `Edits here die on the next sync_plugins / predev — edit the plugin source instead.`;
  }

  return { ok, checked, drifts, message };
}
