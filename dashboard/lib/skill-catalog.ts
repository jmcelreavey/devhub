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
} from "@/lib/ai/tools-skills";
import { pluginAssetDirs } from "./plugins/registry";
import type { AiToolsMeta, SkillListItem, SkillOrigin } from "@/lib/skills/api-types";
import { isReadOnlySkillOrigin } from "@/lib/skills/api-types";
import {
  devhubRootSkillNames,
  devhubSharedSkillsDir,
  devhubVendorSkillsDir,
  listSkillDirNames,
  readSkillDescription,
  resolveSkillDirUnder,
  skillMdPath,
} from "@/lib/skills/shared";
import { readSkillProvenance } from "@/lib/skills/provenance";

export type { SkillOrigin, SkillListItem } from "@/lib/skills/api-types";

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
  vendorDir: string;
  aiToolsDir: string | null;
  aiToolsAvailable: boolean;
}


export const DEVHUB_SKILL_PREFIX = "devhub-";

export function withDevhubSkillPrefix(name: string): string {
  return name.startsWith(DEVHUB_SKILL_PREFIX) ? name : `${DEVHUB_SKILL_PREFIX}${name}`;
}

export function withoutDevhubSkillPrefix(name: string): string {
  return name.startsWith(DEVHUB_SKILL_PREFIX) ? name.slice(DEVHUB_SKILL_PREFIX.length) : name;
}

/** Match a local tool-dir name to a catalog name, including `devhub-` aliases. */
export function resolveCatalogSkillName(
  localName: string,
  catalogNames: Iterable<string>,
): string | null {
  const names = catalogNames instanceof Set ? catalogNames : new Set(catalogNames);
  if (names.has(localName)) return localName;
  const prefixed = withDevhubSkillPrefix(localName);
  if (prefixed !== localName && names.has(prefixed)) return prefixed;
  const unprefixed = withoutDevhubSkillPrefix(localName);
  if (unprefixed !== localName && names.has(unprefixed)) return unprefixed;
  return null;
}

export function isBlockedFromSharedCatalog(
  entry: SkillCatalogEntry | undefined,
  localName: string,
  upstreamOnly: Set<string>,
  autoCollectExcluded: Set<string>,
): boolean {
  if (entry && isReadOnlySkillOrigin(entry.origin)) return true;
  if (entry) return false;
  return upstreamOnly.has(localName) || autoCollectExcluded.has(localName);
}

export function skillCatalogMeta(repoRoot: string): SkillCatalogMeta {
  const devhubDir = devhubSharedSkillsDir(repoRoot);
  const aiToolsAvailable = isAiToolsSyncEnabled() && isAiToolsAvailable();
  return {
    devhubDir,
    vendorDir: devhubVendorSkillsDir(repoRoot),
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
  const { devhubDir, vendorDir, aiToolsDir, aiToolsAvailable } = skillCatalogMeta(repoRoot);
  const devhub = new Set(listSkillDirNames(devhubDir));
  const names = new Set<string>();

  // Vendored skills are externally owned too: collect must not copy them back
  // into skills/shared, which would fork them from upstream and quietly relicense
  // Apache-2.0 code into the MIT tree.
  for (const name of listSkillDirNames(vendorDir)) {
    if (!devhub.has(name)) names.add(name);
  }

  // Root-level skills (skills/<name>) are local installs of externally-owned skills, for the
  // same reason. Without this, collect sees them as "not in skills/shared" and copies them in,
  // duplicating each one and pushing it into the public seed that deliberately drops it.
  for (const name of devhubRootSkillNames(repoRoot)) {
    if (!devhub.has(name)) names.add(name);
  }

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

/**
 * Skills to copy during sync.
 *
 * Precedence: core (skills/shared) > vendor > ai-tools > plugins, first wins on
 * name collision. Vendor sits directly below core so a same-named skill in
 * skills/shared shadows the vendored one — that is the supported way to change
 * vendored behaviour without editing files the next re-vendor will overwrite.
 */
export function buildMergedSkillCatalog(repoRoot: string): SkillCatalogEntry[] {
  const { devhubDir, vendorDir, aiToolsDir, aiToolsAvailable } = skillCatalogMeta(repoRoot);
  const devhubNames = listSkillDirNames(devhubDir);
  const devhubNameSet = new Set(devhubNames);
  const vendorNames = listSkillDirNames(vendorDir);
  const aiToolsNames = aiToolsAvailable && aiToolsDir ? listSkillDirNames(aiToolsDir) : [];
  const aiToolsNameSet = new Set(aiToolsNames.map(aiToolsSkillCatalogName));
  const vendorNameSet = new Set(vendorNames);

  const entries: SkillCatalogEntry[] = [];
  const seenAiToolsCatalogNames = new Set<string>();

  for (const name of devhubNames) {
    entries.push({
      name,
      origin: "devhub",
      dir: path.join(devhubDir, name),
      overridesUpstream: aiToolsNameSet.has(name) || vendorNameSet.has(name),
    });
  }

  for (const name of vendorNames) {
    if (devhubNameSet.has(name)) continue;
    const dir = resolveSkillDirUnder(vendorDir, name);
    if (!dir) continue;
    entries.push({ name, origin: "vendor", dir });
  }

  // Root-level skills/ (not shared/, not vendor/) are third-party installs that
  // live in the private mirror. Surface them in the catalog as read-only so the
  // Skills page does not offer "Add to catalog" and collect does not fork them
  // into the MIT skills/shared tree.
  const skillsRoot = path.join(repoRoot, "skills");
  const rootNameSet = new Set<string>();
  for (const name of devhubRootSkillNames(repoRoot)) {
    if (devhubNameSet.has(name) || vendorNameSet.has(name)) continue;
    const dir = resolveSkillDirUnder(skillsRoot, name);
    if (!dir) continue;
    rootNameSet.add(name);
    entries.push({ name, origin: "vendor", dir });
  }

  for (const name of aiToolsNames) {
    const catalogName = aiToolsSkillCatalogName(name);
    if (
      devhubNameSet.has(catalogName) ||
      vendorNameSet.has(catalogName) ||
      rootNameSet.has(catalogName)
    ) {
      continue;
    }
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
  vendor: number;
  aiTools: number;
  plugins: number;
} {
  let devhub = 0;
  let vendor = 0;
  let aiTools = 0;
  let plugins = 0;
  for (const e of catalog) {
    if (e.origin === "vendor") vendor++;
    else if (e.origin === "ai-tools") aiTools++;
    else if (e.origin.startsWith("plugin:")) plugins++;
    else devhub++;
  }
  return { devhub, vendor, aiTools, plugins };
}

/** Catalog entries sourced from skills/vendor, for provenance validation. */
export function vendorCatalogEntries(
  catalog: SkillCatalogEntry[],
): Array<{ name: string; dir: string }> {
  return catalog
    .filter((e) => e.origin === "vendor" && path.basename(path.dirname(e.dir)) === "vendor")
    .map((e) => ({ name: e.name, dir: e.dir }));
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
  return entries.map((entry) => {
    // Only read provenance for sources where it carries an obligation. Every
    // skills/shared skill is MIT with the repo, so parsing 22 files to
    // rediscover that on each Skills page load buys nothing.
    const provenance = entry.origin === "vendor" ? readSkillProvenance(entry.dir) : null;
    return {
      name: entry.name,
      description: readSkillDescription(entry.dir),
      source: entry.origin,
      readOnly: isReadOnlySkillOrigin(entry.origin),
      overridesUpstream: entry.overridesUpstream,
      license: provenance?.license ?? null,
      sourceUrl: provenance?.source ?? null,
    };
  });
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
