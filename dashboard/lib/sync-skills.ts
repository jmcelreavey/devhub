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
  rewriteAiToolsSkillFrontmatterName,
} from "./ai-tools-skills";
import {
  buildMergedSkillCatalog,
  catalogOriginCounts,
  filterSkillCatalog,
  type SkillCatalogEntry,
} from "./skill-catalog";
import { devhubSharedSkillsDir, SKILL_MD } from "./skills-shared";
import { copyTreeSync, safeRemovePath } from "./server-utils";

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

export const TOOL_DIRS: Record<string, string> = {
  claude: ".claude/skills",
  codex: ".codex/skills",
  opencode: ".opencode/skills",
  "opencode-config": ".config/opencode/skills",
  "opencode-config-single": ".config/opencode/skill",
  cursor: ".cursor/skills",
  "cursor-skills-cursor": ".cursor/skills-cursor",
  "ai-skills": ".ai-skills",
  "config-ai": ".config/ai/skills",
};

export const AGENT_TOOL_DIRS: Array<{ tool: string; subdir: string }> = [
  { tool: "claude", subdir: ".claude/agents" },
  { tool: "codex", subdir: ".codex/agents" },
  { tool: "opencode", subdir: ".config/opencode/agent" },
  { tool: "opencode", subdir: ".config/opencode/agents" },
  { tool: "cursor", subdir: ".cursor/agents" },
  { tool: "config-ai", subdir: ".config/ai/agents" },
];

export function toolDirPaths(home: string): string[] {
  return Object.values(TOOL_DIRS).map((d) => path.join(home, d));
}

export function agentDirEntries(home: string): Array<{ tool: string; path: string }> {
  return AGENT_TOOL_DIRS.map(({ tool, subdir }) => ({ tool, path: path.join(home, subdir) }));
}

type TreeEntryKind = "directory" | "file" | "symlink";

function listRelativeTreeEntries(root: string): Map<string, TreeEntryKind> {
  const entries = new Map<string, TreeEntryKind>();

  function visit(absPath: string, relativePath: string) {
    const stat = fs.lstatSync(absPath);
    const kind: TreeEntryKind = stat.isSymbolicLink()
      ? "symlink"
      : stat.isDirectory()
        ? "directory"
        : "file";
    if (relativePath) entries.set(relativePath, kind);
    if (kind !== "directory") return;
    for (const child of fs.readdirSync(absPath, { withFileTypes: true })) {
      visit(path.join(absPath, child.name), path.join(relativePath, child.name));
    }
  }

  visit(root, "");
  return entries;
}

function readSkillFileForSync(entry: SkillCatalogEntry, relativePath: string): string | Buffer {
  const file = path.join(entry.dir, relativePath);
  if (entry.origin === "ai-tools" && relativePath === SKILL_MD) {
    return rewriteAiToolsSkillFrontmatterName(fs.readFileSync(file, "utf-8"), entry.name);
  }
  return fs.readFileSync(file);
}

export function skillTreesEqualForSync(entry: SkillCatalogEntry, targetDir: string): boolean {
  try {
    const sourceEntries = listRelativeTreeEntries(entry.dir);
    const targetEntries = listRelativeTreeEntries(targetDir);
    if (sourceEntries.size !== targetEntries.size) return false;

    for (const [relativePath, sourceKind] of sourceEntries) {
      const targetKind = targetEntries.get(relativePath);
      if (targetKind !== sourceKind) return false;
      if (sourceKind === "directory") continue;

      const sourceFile = path.join(entry.dir, relativePath);
      const targetFile = path.join(targetDir, relativePath);
      if (sourceKind === "symlink") {
        if (fs.readlinkSync(sourceFile) !== fs.readlinkSync(targetFile)) return false;
        continue;
      }

      const expected = readSkillFileForSync(entry, relativePath);
      const actual = typeof expected === "string" ? fs.readFileSync(targetFile, "utf-8") : fs.readFileSync(targetFile);
      if (typeof expected === "string" ? actual !== expected : !expected.equals(actual as Buffer)) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

export function copySkillForSync(entry: SkillCatalogEntry, targetDir: string): void {
  copyTreeSync(entry.dir, targetDir);
  if (entry.origin !== "ai-tools") return;

  const skillMd = path.join(targetDir, SKILL_MD);
  const content = fs.readFileSync(skillMd, "utf-8");
  fs.writeFileSync(skillMd, rewriteAiToolsSkillFrontmatterName(content, entry.name), "utf-8");
}

export async function syncSkills(opts: SyncSkillsOptions): Promise<number> {
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
  const excluded = new Set((opts.excludeSkills ?? []).map((s) => s.trim()).filter(Boolean));
  const catalog = filterSkillCatalog(fullCatalog, opts);
  const pruneKeepNames = filterSkillCatalog(fullCatalog, { excludeSkills: opts.excludeSkills }).map(
    (e) => e.name,
  );

  const home = os.homedir();
  let toolEntries = Object.entries(TOOL_DIRS).map(
    ([tool, sub]) => [tool, path.join(/*turbopackIgnore: true*/ home, sub)] as const,
  );
  if (opts.tool) {
    if (!TOOL_DIRS[opts.tool]) {
      emit(`ERROR: Unknown tool '${opts.tool}'. Options: ${Object.keys(TOOL_DIRS).join(", ")}`);
      return 1;
    }
    toolEntries = toolEntries.filter(([t]) => t === opts.tool);
  }

  const { devhub: devhubCount, aiTools: upstreamCount, plugins: pluginCount } =
    catalogOriginCounts(catalog);
  if (excluded.size > 0) {
    emit(`Excluding from sync/prune: ${[...excluded].sort().join(", ")}`);
  }
  const pluginPart = pluginCount > 0 ? `, ${pluginCount} plugin` : "";
  emit(
    `Syncing ${catalog.length} skill(s) (${devhubCount} DevHub, ${upstreamCount} ai-tools${pluginPart}) to ${toolEntries.length} target(s)...`,
  );
  if (opts.dryRun) emit("(DRY RUN — no changes will be made)");

  let syncedTotal = 0;
  for (const [tool, targetRoot] of toolEntries) {
    emit(`[${tool}] ${targetRoot}`);

    for (const entry of catalog) {
      const dst = path.join(targetRoot, entry.name);
      const tag = entry.origin === "ai-tools" ? "ai-tools" : "devhub";
      if (opts.dryRun) {
        emit(`  WOULD [${tag}]: ${entry.name} -> ${dst}`);
        syncedTotal++;
        continue;
      }
      try {
        safeRemovePath(dst);
        copySkillForSync(entry, dst);
        emit(`  SYNCED [${tag}]: ${entry.name}`);
        syncedTotal++;
      } catch (e) {
        emit(`  FAILED: ${entry.name} (${e instanceof Error ? e.message : String(e)})`);
      }
    }

    if (opts.prune && fs.existsSync(targetRoot)) {
      for (const existing of fs.readdirSync(targetRoot, { withFileTypes: true })) {
        if (!existing.isDirectory() && !existing.isSymbolicLink()) continue;
        if (pruneKeepNames.includes(existing.name)) continue;
        if (excluded.has(existing.name)) continue;
        const stale = path.join(targetRoot, existing.name);
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

  emit(`Done. ${syncedTotal} skill(s) synced.`);
  return 0;
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
  const toolEntries = Object.entries(TOOL_DIRS).map(
    ([tool, sub]) => [tool, path.join(home, sub)] as const,
  );

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
