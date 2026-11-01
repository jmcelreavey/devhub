import fs from "node:fs";
import path from "node:path";
import type { SkillCatalogEntry } from "../lib/skills/catalog";
import { rewriteAiToolsSkillFrontmatterName } from "../lib/ai/tools-skills";
import { SKILL_MD } from "../lib/skills/shared";
import { copyTreeSync } from "../lib/server-utils";

export const TOOL_DIRS: Record<string, string> = {
  claude: ".claude/skills",
  codex: ".codex/skills",
  // ChatGPT.app is the Codex desktop — same skill dir as `codex`. Alias so
  // sync_skills / preview list ChatGPT instead of dropping the system link.
  chatgpt: ".codex/skills",
  opencode: ".opencode/skills",
  "opencode-config": ".config/opencode/skills",
  "opencode-config-single": ".config/opencode/skill",
  cursor: ".cursor/skills",
  // Agent Skills spec user root. Cursor Customize → Skills lists this, not skills-cursor
  // (that folder is Cursor's internal builtins and must not be a sync target).
  agents: ".agents/skills",
  antigravity: ".gemini/config/skills",
  "ai-skills": ".ai-skills",
  "config-ai": ".config/ai/skills",
};

/** Comma-separated sync target names to skip during an all-target skill sync. */
export const SKILL_SYNC_EXCLUDE_TOOLS_ENV = "DEVHUB_SKILL_SYNC_EXCLUDE_TOOLS";

export const AGENT_TOOL_DIRS: Array<{ tool: string; subdir: string }> = [
  { tool: "claude", subdir: ".claude/agents" },
  { tool: "codex", subdir: ".codex/agents" },
  { tool: "chatgpt", subdir: ".codex/agents" },
  { tool: "opencode", subdir: ".config/opencode/agent" },
  { tool: "opencode", subdir: ".config/opencode/agents" },
  { tool: "cursor", subdir: ".cursor/agents" },
  { tool: "antigravity", subdir: ".gemini/config/agents" },
  { tool: "config-ai", subdir: ".config/ai/agents" },
];

export function toolDirPaths(home: string): string[] {
  return Object.values(TOOL_DIRS).map((d) => path.join(home, d));
}

function excludedSkillSyncTools(raw = process.env[SKILL_SYNC_EXCLUDE_TOOLS_ENV]): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((tool) => tool.trim())
      .filter((tool) => tool in TOOL_DIRS),
  );
}

/**
 * All enabled skill-sync destinations. An explicit `tool` is always honored so
 * a temporarily excluded destination can still be synced on demand.
 */
export function skillSyncToolEntries(home: string, tool?: string): Array<[string, string]> {
  const entries = Object.entries(TOOL_DIRS).map(
    ([name, subdir]) => [name, path.join(home, subdir)] as [string, string],
  );
  if (tool) return entries.filter(([name]) => name === tool);

  const excluded = excludedSkillSyncTools();
  return entries.filter(([name]) => !excluded.has(name));
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

export type SkillTreeSnapshot = Map<
  string,
  { kind: TreeEntryKind; content?: string | Buffer; link?: string; executable?: boolean }
>;

function isExecutable(file: string): boolean {
  return (fs.statSync(file).mode & 0o111) !== 0;
}

/**
 * Source tree + file contents as sync would write them. Taken once per skill
 * and reused for every target — re-reading the source per target read large
 * skills (ui-ux-pro-max is 3.6 MB) a dozen times each sync.
 */
export function snapshotSkillTree(entry: SkillCatalogEntry): SkillTreeSnapshot {
  const snapshot: SkillTreeSnapshot = new Map();
  for (const [relativePath, kind] of listRelativeTreeEntries(entry.dir)) {
    if (kind === "directory") snapshot.set(relativePath, { kind });
    else if (kind === "symlink") snapshot.set(relativePath, { kind, link: fs.readlinkSync(path.join(entry.dir, relativePath)) });
    else {
      snapshot.set(relativePath, {
        kind,
        content: readSkillFileForSync(entry, relativePath),
        // Skills ship runnable scripts (impeccable, lean-ctx); a target copy
        // that lost +x must count as changed so sync restores it.
        executable: isExecutable(path.join(entry.dir, relativePath)),
      });
    }
  }
  return snapshot;
}

export function skillTreesEqualForSync(
  entry: SkillCatalogEntry,
  targetDir: string,
  snapshot?: SkillTreeSnapshot,
): boolean {
  try {
    const source = snapshot ?? snapshotSkillTree(entry);
    const targetEntries = listRelativeTreeEntries(targetDir);
    if (source.size !== targetEntries.size) return false;

    for (const [relativePath, expected] of source) {
      if (targetEntries.get(relativePath) !== expected.kind) return false;
      if (expected.kind === "directory") continue;

      const targetFile = path.join(targetDir, relativePath);
      if (expected.kind === "symlink") {
        if (fs.readlinkSync(targetFile) !== expected.link) return false;
        continue;
      }

      if (isExecutable(targetFile) !== expected.executable) return false;
      const content = expected.content!;
      const actual = typeof content === "string" ? fs.readFileSync(targetFile, "utf-8") : fs.readFileSync(targetFile);
      if (typeof content === "string" ? actual !== content : !content.equals(actual as Buffer)) {
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

