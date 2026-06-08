import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatAgentForTool } from "./agent-sync-format";
import { buildMergedSkillCatalog } from "./skill-catalog";
import { agentDirEntries, skillTreesEqualForSync, TOOL_DIRS } from "./sync-skills";
import type { SyncPreviewKind, SyncPreviewResult, SyncPreviewTarget, SyncPreviewWrite } from "./sync-preview-types";

export interface BuildSyncPreviewOptions {
  kind: SyncPreviewKind;
  repoRoot: string;
  exclude?: string[];
  prune?: boolean;
}

function listAgentNames(sourceDir: string): string[] {
  if (!fs.existsSync(sourceDir)) return [];
  return fs
    .readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name.slice(0, -".md".length))
    .sort();
}

function previewSkillTarget(params: {
  catalog: ReturnType<typeof buildMergedSkillCatalog>;
  targetRoot: string;
  keepNames: string[];
  excludedNames: string[];
  tool: string;
  prune: boolean;
}): SyncPreviewTarget {
  const writes: SyncPreviewWrite[] = [];
  let unchanged = 0;

  for (const entry of params.catalog) {
    const dst = path.join(params.targetRoot, entry.name);
    if (!fs.existsSync(dst)) {
      writes.push({ name: entry.name, reason: "missing" });
    } else if (!skillTreesEqualForSync(entry, dst)) {
      writes.push({ name: entry.name, reason: "changed" });
    } else {
      unchanged++;
    }
  }

  const prunes: string[] = [];
  if (params.prune && fs.existsSync(params.targetRoot)) {
    for (const entry of fs.readdirSync(params.targetRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const name = entry.name;
      if (params.keepNames.includes(name)) continue;
      if (params.excludedNames.includes(name)) continue;
      prunes.push(name);
    }
  }

  return {
    tool: params.tool,
    path: params.targetRoot,
    writes,
    prunes: prunes.sort(),
    unchanged,
  };
}

function previewAgentTarget(params: {
  sourceDir: string;
  targetRoot: string;
  sourceNames: string[];
  keepNames: string[];
  excludedNames: string[];
  tool: string;
  prune: boolean;
}): SyncPreviewTarget {
  const writes: SyncPreviewWrite[] = [];
  let unchanged = 0;

  for (const name of params.sourceNames) {
    const src = path.join(params.sourceDir, `${name}.md`);
    const dst = path.join(params.targetRoot, `${name}.md`);
    const formatted = formatAgentForTool(fs.readFileSync(src, "utf-8"), params.tool);
    if (!fs.existsSync(dst)) {
      writes.push({ name, reason: "missing" });
    } else if (fs.readFileSync(dst, "utf-8") !== formatted) {
      writes.push({ name, reason: "changed" });
    } else {
      unchanged++;
    }
  }

  const prunes: string[] = [];
  if (params.prune && fs.existsSync(params.targetRoot)) {
    for (const entry of fs.readdirSync(params.targetRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const name = entry.name.slice(0, -".md".length);
      if (params.keepNames.includes(name)) continue;
      if (params.excludedNames.includes(name)) continue;
      prunes.push(name);
    }
  }

  return {
    tool: params.tool,
    path: params.targetRoot,
    writes,
    prunes: prunes.sort(),
    unchanged,
  };
}

export function buildSyncPreview(opts: BuildSyncPreviewOptions): SyncPreviewResult {
  const excluded = new Set((opts.exclude ?? []).map((name) => name.trim()).filter(Boolean));
  const prune = opts.prune === true;
  const home = os.homedir();

  if (opts.kind === "skill") {
    const fullCatalog = buildMergedSkillCatalog(opts.repoRoot);
    const catalog = fullCatalog.filter((e) => !excluded.has(e.name));
    const keepNames = fullCatalog.filter((e) => !excluded.has(e.name)).map((e) => e.name);
    const targets = Object.entries(TOOL_DIRS).map(([tool, subdir]) => ({
      tool,
      path: path.join(home, subdir),
    }));

    return {
      kind: opts.kind,
      sourceCount: catalog.length,
      excluded: [...excluded].sort(),
      prune,
      targets: targets.map((target) =>
        previewSkillTarget({
          catalog,
          targetRoot: target.path,
          keepNames,
          excludedNames: [...excluded],
          tool: target.tool,
          prune,
        }),
      ),
    };
  }

  const sourceDir = path.join(opts.repoRoot, "agents/shared");
  const allNames = listAgentNames(sourceDir);
  const sourceNames = allNames.filter((name) => !excluded.has(name));
  const targets = agentDirEntries(home);

  return {
    kind: opts.kind,
    sourceCount: sourceNames.length,
    excluded: [...excluded].sort(),
    prune,
    targets: targets.map((target) =>
      previewAgentTarget({
        sourceDir,
        targetRoot: target.path,
        sourceNames,
        keepNames: sourceNames,
        excludedNames: [...excluded],
        tool: target.tool,
        prune,
      }),
    ),
  };
}
