import { TOOL_DIRS, skillSyncToolEntries, snapshotSkillTree, skillTreesEqualForSync, copySkillForSync, type SkillTreeSnapshot } from "../../local/skill-copy";
export { TOOL_DIRS, AGENT_TOOL_DIRS, SKILL_SYNC_EXCLUDE_TOOLS_ENV, toolDirPaths, skillSyncToolEntries, agentDirEntries, snapshotSkillTree, skillTreesEqualForSync, copySkillForSync } from "../../local/skill-copy";
/**
 * In-process port of scripts/sync_skills.py.
 *
 * Copies merged skills (skills/shared + optional ai-tools upstream) into per-tool
 * skill directories under ~/. With { prune: true } it also removes skills present
 * locally but no longer in the catalog (default for dashboard-side deletes to propagate).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isAiToolsRefreshOnSyncEnabled,
  refreshAiToolsRepo,
} from "../ai/tools-skills";
import {
  buildMergedSkillCatalog,
  catalogOriginCounts,
  filterSkillCatalog,
  vendorCatalogEntries,
  type SkillCatalogEntry,
} from "../skills/catalog";
import { formatProvenanceProblems, validateVendorProvenance } from "../skills/provenance";
import { auditVendorSkillDir, formatVendorFindings } from "../skills/vendor-audit";
import {
  devhubParkedSkillsDir,
  devhubSharedSkillsDir,
  listSkillDirNames,
} from "../skills/shared";
import { safeRemovePath } from "../server-utils";
import { pluginOriginGuard, managedTargetPaths } from "../plugins/origin-guard";
import { withPluginPathsLock } from "../plugins/lock";
import { resolvePluginPaths } from "../plugins/paths";

export interface SyncSkillsOptions {
  prune?: boolean;
  dryRun?: boolean;
  /** Limit to specific skill names. Empty/omitted = all. */
  skills?: string[];
  /** Skill names to skip copying; also never pruned from targets when prune is on. */
  excludeSkills?: string[];
  /** Limit to a specific tool ("claude" | "codex" | …). */
  tool?: string;
  /** When false, skip upstream skills fetch for the ai-tools checkout. Default true. */
  refreshAiTools?: boolean;
  emit: (line: string) => void;
  repoRoot: string;
}

function originSyncTag(origin: SkillCatalogEntry["origin"]): string {
  if (origin === "ai-tools" || origin === "vendor") return origin;
  if (origin.startsWith("plugin:")) return "plugin";
  return "devhub";
}

function blockedVendorSkillNames(
  catalog: SkillCatalogEntry[],
  emit: (line: string) => void,
): Set<string> {
  const vendor = vendorCatalogEntries(catalog);
  const blocked = new Set<string>();
  const provenanceProblems = validateVendorProvenance(vendor);
  if (provenanceProblems.length > 0) {
    emit(formatProvenanceProblems(provenanceProblems));
    for (const problem of provenanceProblems) blocked.add(problem.skill);
  }
  const findings = vendor.flatMap((entry) =>
    auditVendorSkillDir(entry.dir, path.dirname(entry.dir)),
  );
  if (findings.length > 0) {
    emit(formatVendorFindings(findings));
    for (const finding of findings) {
      const skill = finding.file.split(/[\\/]/)[0];
      if (skill) blocked.add(skill);
    }
  }
  return blocked;
}

/** Low-use vendored skills kept in-repo for provenance/evals but not synced to tools by default. */
const DEFAULT_SYNC_EXCLUDE_SKILLS = [
  "project-graveyard",
  "scope-creep-detector",
] as const;

export async function syncSkills(opts: SyncSkillsOptions): Promise<number> {
  return withPluginPathsLock(resolvePluginPaths(), () => syncSkillsLocked(opts));
}

async function syncSkillsLocked(opts: SyncSkillsOptions): Promise<number> {
  const protectedPaths = managedTargetPaths();
  const { emit, repoRoot } = opts;
  const devhubSkillsDir = devhubSharedSkillsDir(/*turbopackIgnore: true*/ repoRoot);
  if (!fs.existsSync(/*turbopackIgnore: true*/ devhubSkillsDir)) {
    emit(`ERROR: Source skills directory not found: ${devhubSkillsDir}`);
    return 1;
  }

  if (opts.refreshAiTools === false) {
    emit("Skipping ai-tools git refresh (refreshAiTools=false).");
  } else if (!isAiToolsRefreshOnSyncEnabled()) {
    emit("Skipping ai-tools git refresh (AI_TOOLS_REFRESH_ON_SYNC=0).");
  } else {
    await refreshAiToolsRepo({ emit, dryRun: opts.dryRun });
  }

  const fullCatalog = buildMergedSkillCatalog(repoRoot);
  const eyeExcluded = new Set((opts.excludeSkills ?? []).map((s) => s.trim()).filter(Boolean));
  const excluded = new Set<string>([...DEFAULT_SYNC_EXCLUDE_SKILLS, ...eyeExcluded]);
  const filterOpts = { ...opts, excludeSkills: [...excluded] };
  const blocked = blockedVendorSkillNames(filterSkillCatalog(fullCatalog, filterOpts), emit);
  const catalog = filterSkillCatalog(fullCatalog, filterOpts).filter((entry) => !blocked.has(entry.name));
  const pruneKeepNames = new Set(catalog.map((e) => e.name));
  // Parked skills are removed from targets even without prune: prune is off
  // for routine syncs because targets also hold skills DevHub doesn't own.
  // Only an exact copy of the parked tree is removed, so a same-named skill the
  // user installed or edited themselves survives.
  const parkedDir = devhubParkedSkillsDir(repoRoot);
  const parkedEntries: SkillCatalogEntry[] = listSkillDirNames(parkedDir)
    .filter((name) => !pruneKeepNames.has(name) && !eyeExcluded.has(name))
    .map((name) => ({ name, origin: "devhub", dir: path.join(parkedDir, name) }));

  const snapshots = new Map<string, SkillTreeSnapshot>();
  const sourceSnapshot = (entry: SkillCatalogEntry): SkillTreeSnapshot => {
    let snapshot = snapshots.get(entry.name);
    if (!snapshot) {
      snapshot = snapshotSkillTree(entry);
      snapshots.set(entry.name, snapshot);
    }
    return snapshot;
  };

  const home = os.homedir();
  if (opts.tool) {
    if (!TOOL_DIRS[opts.tool]) {
      emit(`ERROR: Unknown tool '${opts.tool}'. Options: ${Object.keys(TOOL_DIRS).join(", ")}`);
      return 1;
    }
  }
  const toolEntries = skillSyncToolEntries(home, opts.tool);

  const { devhub: devhubCount, vendor: vendorCount, aiTools: upstreamCount, plugins: pluginCount } =
    catalogOriginCounts(catalog);
  if (excluded.size > 0) {
    emit(`Excluding from sync/prune: ${[...excluded].sort().join(", ")}`);
  }
  const originParts = [`${devhubCount} DevHub`, `${upstreamCount} ai-tools`];
  if (vendorCount > 0) originParts.push(`${vendorCount} vendor`);
  if (pluginCount > 0) originParts.push(`${pluginCount} plugin`);
  emit(
    `Syncing ${catalog.length} skill(s) (${originParts.join(", ")}) to ${toolEntries.length} target(s)...`,
  );
  if (opts.dryRun) emit("(DRY RUN — no changes will be made)");

  const originGuard = pluginOriginGuard();
  let syncedTotal = 0;
  for (const [tool, targetRoot] of toolEntries) {
    emit(`[${tool}] ${targetRoot}`);

    for (const entry of catalog) {
      const dst = path.join(targetRoot, entry.name);
      const tag = originSyncTag(entry.origin);
      if (protectedPaths.has(path.resolve(dst))) {
        emit(`  KEPT [${tag}]: ${entry.name} is managed in Plugins`);
        continue;
      }
      if (!(await originGuard(entry.origin))) {
        emit(`  SKIPPED [${tag}]: ${entry.name} is disabled or managed in Plugins`);
        continue;
      }
      if (opts.dryRun) {
        emit(`  WOULD [${tag}]: ${entry.name} -> ${dst}`);
        syncedTotal++;
        continue;
      }
      try {
        // Rewriting unchanged trees on every sync cost ~40 MB of writes
        // across all targets; compare first.
        if (skillTreesEqualForSync(entry, dst, sourceSnapshot(entry))) {
          emit(`  UNCHANGED [${tag}]: ${entry.name}`);
          syncedTotal++;
          continue;
        }
        safeRemovePath(dst);
        copySkillForSync(entry, dst);
        emit(`  SYNCED [${tag}]: ${entry.name}`);
        syncedTotal++;
      } catch (e) {
        emit(`  FAILED: ${entry.name} (${e instanceof Error ? e.message : String(e)})`);
      }
    }

    for (const parkedEntry of parkedEntries) {
      const { name } = parkedEntry;
      const parked = path.join(targetRoot, name);
      if (protectedPaths.has(path.resolve(parked))) continue;
      if (!fs.existsSync(parked)) continue;
      if (!skillTreesEqualForSync(parkedEntry, parked)) {
        emit(`  KEPT PARKED (differs from skills/parked copy): ${name}`);
        continue;
      }
      if (opts.dryRun) {
        emit(`  WOULD REMOVE PARKED: ${name}`);
        continue;
      }
      try {
        fs.rmSync(parked, { recursive: true, force: true });
        emit(`  REMOVED PARKED: ${name}`);
      } catch (e) {
        emit(`  REMOVE PARKED FAILED: ${name} (${e instanceof Error ? e.message : String(e)})`);
      }
    }

    if (opts.prune && fs.existsSync(targetRoot)) {
      for (const existing of fs.readdirSync(targetRoot, { withFileTypes: true })) {
        if (!existing.isDirectory() && !existing.isSymbolicLink()) continue;
        if (pruneKeepNames.has(existing.name)) continue;
        if (eyeExcluded.has(existing.name)) continue;
        const stale = path.join(targetRoot, existing.name);
        if (protectedPaths.has(path.resolve(stale))) continue;
        if (opts.dryRun) {
          emit(`  WOULD PRUNE: ${existing.name}`);
          continue;
        }
        try {
          fs.rmSync(stale, { recursive: true, force: true });
          emit(`  PRUNED: ${existing.name}`);
        } catch (e) {
          emit(`  PRUNE FAILED: ${existing.name} (${e instanceof Error ? e.message : String(e)})`);
        }
      }
    }
  }

  if (!opts.tool || opts.tool === "antigravity") {
    writeAntigravitySkillsIndex(home, emit, opts.dryRun);
  }

  emit(`Done. ${syncedTotal} skill(s) synced.`);
  return blocked.size > 0 ? 1 : 0;
}

function writeAntigravitySkillsIndex(
  home: string,
  emit: (line: string) => void,
  dryRun?: boolean,
): void {
  const skillsDir = path.join(home, TOOL_DIRS.antigravity);
  const indexPath = path.join(home, ".gemini", "config", "skills.json");
  const payload = { entries: [{ path: skillsDir }] };
  if (dryRun) {
    emit(`[antigravity] WOULD WRITE ${indexPath}`);
    return;
  }
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, JSON.stringify(payload, null, 2) + "\n");
  emit(`[antigravity] INDEX ${indexPath}`);
}

export interface VerifySyncOptions {
  emit: (line: string) => void;
  repoRoot: string;
}

export interface VerifyResult {
  healthy: number;
  missing: Array<{ tool: string; name: string }>;
  unreadable: Array<{ tool: string; name: string; error: string }>;
}

export async function verifySync(opts: VerifySyncOptions): Promise<VerifyResult> {
  const { emit, repoRoot } = opts;
  const expected = buildMergedSkillCatalog(repoRoot).map((e) => e.name);
  if (expected.length === 0) return { healthy: 0, missing: [], unreadable: [] };

  const home = os.homedir();
  const toolEntries = skillSyncToolEntries(home);

  const result: VerifyResult = { healthy: 0, missing: [], unreadable: [] };

  for (const [tool, targetRoot] of toolEntries) {
    if (!fs.existsSync(targetRoot)) {
      for (const name of expected) result.missing.push({ tool, name });
      continue;
    }
    for (const name of expected) {
      const dst = path.join(targetRoot, name, "SKILL.md");
      try {
        if (!fs.existsSync(dst)) {
          result.missing.push({ tool, name });
          continue;
        }
        fs.readFileSync(dst, "utf-8");
        result.healthy++;
      } catch (e) {
        result.unreadable.push({ tool, name, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  if (result.missing.length > 0 || result.unreadable.length > 0) {
    emit("=== Sync Health Warnings ===");
    for (const m of result.missing) emit(`  MISSING: [${m.tool}] ${m.name}`);
    for (const u of result.unreadable) emit(`  UNREADABLE: [${u.tool}] ${u.name}: ${u.error}`);
  } else {
    emit(`Sync health OK — ${result.healthy} skill(s) verified across ${toolEntries.length} target(s).`);
  }

  return result;
}
