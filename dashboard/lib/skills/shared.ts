/**
 * Shared skill filesystem conventions used by catalog, sync, collect, and API routes.
 */
import fs from "node:fs";
import path from "node:path";

export const SKILL_MD = "SKILL.md";

/** Lowercase slug for skill directory names (skills/shared/foo, ~/.codex/skills/foo). */
export const SKILL_SLUG = /^[a-z0-9][a-z0-9_-]{0,62}$/;

export const READ_ONLY_UPSTREAM_SKILL_ERROR =
  "Upstream and plugin skills are read-only in DevHub — edit them in their source repo (ai-tools or the plugin).";

export function devhubSharedSkillsDir(repoRoot: string): string {
  return path.join(repoRoot, "skills", "shared");
}

/** List skill folder names under a parent that contains `<name>/SKILL.md`. */
export function listSkillDirNames(skillsParentDir: string): string[] {
  if (!fs.existsSync(skillsParentDir)) return [];
  return fs
    .readdirSync(skillsParentDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => fs.existsSync(path.join(skillsParentDir, e.name, SKILL_MD)))
    .map((e) => e.name)
    .sort();
}

export function resolveSkillDirUnder(skillsParentDir: string, name: string): string | null {
  const skillDir = path.join(skillsParentDir, name);
  const resolved = path.resolve(skillDir);
  if (path.dirname(resolved) !== path.resolve(skillsParentDir)) return null;
  if (!fs.existsSync(path.join(resolved, SKILL_MD))) return null;
  return resolved;
}

export function skillMdPath(skillDir: string): string {
  return path.join(skillDir, SKILL_MD);
}

/** Extract a `description:` (or first prose line) from skill/agent markdown frontmatter. */
export function descriptionFromFrontmatter(content: string): string | null {
  const descMatch = content.match(/^description:\s*(.+)/m);
  if (descMatch) return descMatch[1].trim().replace(/['"]/g, "");
  const lines = content.split("\n").filter(Boolean);
  const nonHeader = lines.find((l) => !l.startsWith("#") && !l.startsWith("---") && !l.includes(":"));
  return nonHeader?.trim() ?? null;
}

export function readSkillDescription(skillDir: string): string | null {
  const file = skillMdPath(skillDir);
  try {
    if (!fs.existsSync(file)) return null;
    return descriptionFromFrontmatter(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}
