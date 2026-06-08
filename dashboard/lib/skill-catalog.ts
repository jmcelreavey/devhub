/**
 * Merged skill catalog: DevHub skills/shared (editable) + ai-tools/skills (read-only upstream).
 */
import os from "node:os";
import path from "node:path";
import {
  aiToolsSkillCatalogName,
  aiToolsSkillsDir,
  isAiToolsAvailable,
  isAiToolsSyncEnabled,
  resolveAiToolsRoot,
} from "./ai-tools-skills";
import { pluginAssetDirs } from "./plugins/registry";
import type { AiToolsMeta, SkillListItem, SkillOrigin } from "./skills-api-types";
import { isReadOnlySkillOrigin } from "./skills-api-types";
import {
  devhubSharedSkillsDir,
  listSkillDirNames,
  readSkillDescription,
  resolveSkillDirUnder,
  skillMdPath,
} from "./skills-shared";

export type { SkillOrigin, SkillListItem } from "./skills-api-types";

export interface SkillCatalogEntry {
  name: string;
  origin: SkillOrigin;
  /** Original upstream directory name when the public catalog name is prefixed. */
  sourceName?: string;
  /** Absolute path to the skill directory to copy from. */
  dir: string;
  /** DevHub skill that replaces the same-named ai-tools skill. */
  overridesUpstream?: boolean;
}

export interface SkillCatalogMeta {
  devhubDir: string;
  aiToolsDir: string | null;
  aiToolsAvailable: boolean;
}

export function skillCatalogMeta(repoRoot: string): SkillCatalogMeta {
  const devhubDir = devhubSharedSkillsDir(repoRoot);
  const aiToolsAvailable = isAiToolsSyncEnabled() && isAiToolsAvailable();
  return {
    devhubDir,
    aiToolsDir: aiToolsAvailable ? aiToolsSkillsDir() : null,
    aiToolsAvailable,
  };
}

export function buildAiToolsMeta(_repoRoot: string): AiToolsMeta {
  const meta = skillCatalogMeta(_repoRoot);
  return {
    available: meta.aiToolsAvailable,
    path: meta.aiToolsDir,
    root: resolveAiToolsRoot(),
    syncEnabled: isAiToolsSyncEnabled(),
  };
}

/**
 * Skill names owned by a read-only source (ai-tools upstream or a plugin) and not by
 * skills/shared. Used by collect to avoid duplicating externally-owned skills back into
 * the repo.
 */
export function upstreamOnlySkillNames(repoRoot: string): Set<string> {
  const { devhubDir, aiToolsDir, aiToolsAvailable } = skillCatalogMeta(repoRoot);
  const devhub = new Set(listSkillDirNames(devhubDir));
  const names = new Set<string>();

  if (aiToolsAvailable && aiToolsDir) {
    for (const sourceName of listSkillDirNames(aiToolsDir)) {
      const catalogName = aiToolsSkillCatalogName(sourceName);
      if (devhub.has(catalogName)) {
        if (catalogName !== sourceName) names.add(sourceName);
        continue;
      }
      names.add(catalogName);
      if (catalogName !== sourceName) names.add(sourceName);
    }
  }

  for (const { dir } of pluginAssetDirs("skills", os.homedir())) {
    for (const name of listSkillDirNames(dir)) {
      if (!devhub.has(name)) names.add(name);
    }
  }

  return names;
}

/** Skills to copy during sync (devhub wins on name collision). */
export function buildMergedSkillCatalog(repoRoot: string): SkillCatalogEntry[] {
  const { devhubDir, aiToolsDir, aiToolsAvailable } = skillCatalogMeta(repoRoot);
  const devhubNames = listSkillDirNames(devhubDir);
  const devhubNameSet = new Set(devhubNames);
  const aiToolsNames = aiToolsAvailable && aiToolsDir ? listSkillDirNames(aiToolsDir) : [];
  const aiToolsNameSet = new Set(aiToolsNames.map(aiToolsSkillCatalogName));

  const entries: SkillCatalogEntry[] = [];
  const seenAiToolsCatalogNames = new Set<string>();

  for (const name of devhubNames) {
    entries.push({
      name,
      origin: "devhub",
      dir: path.join(devhubDir, name),
      overridesUpstream: aiToolsNameSet.has(name),
    });
  }

  for (const name of aiToolsNames) {
    const catalogName = aiToolsSkillCatalogName(name);
    if (devhubNameSet.has(catalogName)) continue;
    if (seenAiToolsCatalogNames.has(catalogName)) continue;
    seenAiToolsCatalogNames.add(catalogName);
    const dir = resolveSkillDirUnder(aiToolsDir!, name);
    if (!dir) continue;
    entries.push({ name: catalogName, sourceName: name, origin: "ai-tools", dir });
  }

  // Plugin-contributed skills come last: devhub (core) and ai-tools win on name
  // collisions, then plugins in registry order, first plugin wins among themselves.
  const claimed = new Set(entries.map((e) => e.name));
  for (const { plugin, dir: skillsDir } of pluginAssetDirs("skills", os.homedir())) {
    const origin: SkillOrigin = `plugin:${plugin}`;
    for (const name of listSkillDirNames(skillsDir)) {
      if (claimed.has(name)) continue;
      const dir = resolveSkillDirUnder(skillsDir, name);
      if (!dir) continue;
      claimed.add(name);
      entries.push({ name, origin, dir });
    }
  }

  return entries;
}

export function filterSkillCatalog(
  catalog: SkillCatalogEntry[],
  opts: { skills?: string[]; excludeSkills?: string[] },
): SkillCatalogEntry[] {
  const excluded = new Set((opts.excludeSkills ?? []).map((s) => s.trim()).filter(Boolean));
  let entries = catalog.filter((e) => !excluded.has(e.name));
  if (opts.skills?.length) {
    const pick = new Set(opts.skills);
    entries = entries.filter((e) => pick.has(e.name));
  }
  return entries;
}

export function catalogOriginCounts(catalog: SkillCatalogEntry[]): {
  devhub: number;
  aiTools: number;
  plugins: number;
} {
  let devhub = 0;
  let aiTools = 0;
  let plugins = 0;
  for (const e of catalog) {
    if (e.origin === "ai-tools") aiTools++;
    else if (e.origin.startsWith("plugin:")) plugins++;
    else devhub++;
  }
  return { devhub, aiTools, plugins };
}

export interface SkillCatalogContext {
  meta: SkillCatalogMeta;
  entries: SkillCatalogEntry[];
}

/** Build the merged catalog once per request or sync pass. */
export function createSkillCatalogContext(repoRoot: string): SkillCatalogContext {
  const meta = skillCatalogMeta(repoRoot);
  return { meta, entries: buildMergedSkillCatalog(repoRoot) };
}

export function listSkillsFromCatalog(entries: SkillCatalogEntry[]): SkillListItem[] {
  return entries.map((entry) => ({
    name: entry.name,
    description: readSkillDescription(entry.dir),
    source: entry.origin,
    readOnly: isReadOnlySkillOrigin(entry.origin),
    overridesUpstream: entry.overridesUpstream,
  }));
}

export function listSkillsForApi(repoRoot: string): SkillListItem[] {
  return listSkillsFromCatalog(createSkillCatalogContext(repoRoot).entries);
}

export function resolveSkillInCatalog(
  entries: SkillCatalogEntry[],
  name: string,
): {
  file: string;
  dir: string;
  source: SkillOrigin;
  readOnly: boolean;
  overridesUpstream?: boolean;
} | null {
  const entry = entries.find((e) => e.name === name);
  if (!entry) return null;
  return {
    file: skillMdPath(entry.dir),
    dir: entry.dir,
    source: entry.origin,
    readOnly: isReadOnlySkillOrigin(entry.origin),
    overridesUpstream: entry.overridesUpstream,
  };
}

export function resolveSkillForRead(
  repoRoot: string,
  name: string,
): ReturnType<typeof resolveSkillInCatalog> {
  return resolveSkillInCatalog(createSkillCatalogContext(repoRoot).entries, name);
}
