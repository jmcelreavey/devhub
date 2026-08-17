/**
 * Shared skill filesystem conventions used by catalog, sync, collect, and API routes.
 */
import fs from "node:fs";
import path from "node:path";

export const SKILL_MD = "SKILL.md";

/** Lowercase slug for skill directory names (skills/shared/foo, ~/.codex/skills/foo). */
export const SKILL_SLUG = /^[a-z0-9][a-z0-9_-]{0,62}$/;

export const READ_ONLY_UPSTREAM_SKILL_ERROR =
  "Upstream, vendored and plugin skills are read-only in DevHub — edit them in their source repo (ai-tools, skills/vendor upstream, or the plugin).";

export function devhubSharedSkillsDir(repoRoot: string): string {
  return path.join(repoRoot, "skills", "shared");
}

/**
 * Third-party skills copied in from upstream projects under their own licence.
 *
 * Separate from skills/shared because the licence boundary needs to be visible
 * without opening files: everything under skills/shared is MIT with the repo,
 * everything here is not.
 */
export function devhubVendorSkillsDir(repoRoot: string): string {
  return path.join(repoRoot, "skills", "vendor");
}

/**
 * Skills installed at the root of `skills/` — not under shared/ or vendor/.
 *
 * These are local installs of externally-owned skills. make-public-seed keeps only
 * skills/shared and deletes the rest precisely because these are not ours to publish,
 * so collect must treat them the same way it treats vendor/ and plugin skills.
 */
export function devhubRootSkillNames(repoRoot: string): string[] {
  const root = path.join(repoRoot, "skills");
  return listSkillDirNames(root).filter((name) => name !== "shared" && name !== "vendor");
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

/** `description: >-` / `|` and friends — a YAML block scalar header. */
const BLOCK_SCALAR_HEADER = /^(\s*)description:\s*([|>])[+-]?\d*\s*$/;

/** `description: value`, possibly quoted. */
const INLINE_DESCRIPTION = /^\s*description:\s*(.+?)\s*$/;

/** Strip one layer of matching surrounding quotes, leaving inner apostrophes alone. */
export function unquote(value: string): string {
  const match = value.match(/^(['"])([\s\S]*)\1$/);
  return match ? match[2] : value;
}

/** Extract the fenced `---` frontmatter block, or null when there isn't one. */
export function frontmatterBlock(content: string): string[] | null {
  const lines = content.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === "") continue;
    if (lines[i].trim() !== "---") return null;
    start = i;
    break;
  }
  if (start < 0) return null;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") return lines.slice(start + 1, i);
  }
  return null;
}

/**
 * Read the indented body of a YAML block scalar and flatten it to one string.
 *
 * Folded (`>`) joins wrapped lines with spaces; literal (`|`) keeps the line
 * breaks. Chomping indicators (`-`, `+`) only affect trailing newlines, which
 * we trim either way, so they are parsed but ignored.
 */
function readBlockScalar(lines: string[], headerIndex: number, keyIndent: number, style: "|" | ">"): string {
  const body: string[] = [];
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "") {
      body.push("");
      continue;
    }
    const indent = line.length - line.trimStart().length;
    if (indent <= keyIndent) break;
    body.push(line);
  }
  while (body.length > 0 && body[body.length - 1] === "") body.pop();
  if (body.length === 0) return "";

  const indents = body.filter((l) => l.trim() !== "").map((l) => l.length - l.trimStart().length);
  const minIndent = Math.min(...indents);
  const dedented = body.map((l) => (l.trim() === "" ? "" : l.slice(minIndent)));

  if (style === "|") return dedented.join("\n").trim();

  // Folded: a blank line is a paragraph break, everything else joins with a space.
  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const line of dedented) {
    if (line === "") {
      if (current.length > 0) paragraphs.push(current.join(" "));
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) paragraphs.push(current.join(" "));
  return paragraphs.join("\n\n").trim();
}

function descriptionFromLines(lines: string[]): string | null {
  for (let i = 0; i < lines.length; i += 1) {
    const block = lines[i].match(BLOCK_SCALAR_HEADER);
    if (block) {
      const [, indent, style] = block;
      const value = readBlockScalar(lines, i, indent.length, style as "|" | ">");
      return value || null;
    }

    const inline = lines[i].match(INLINE_DESCRIPTION);
    if (inline) {
      const value = unquote(inline[1]).trim();
      return value || null;
    }
  }
  return null;
}

/**
 * Extract a `description:` (or first prose line) from skill/agent markdown
 * frontmatter.
 *
 * Handles YAML block scalars. The previous implementation matched
 * `/^description:\s*(.+)/m` and so captured the *indicator* — 10 of 42 skills
 * reported their description as the literal string `">-"`, because a long
 * description is naturally written as `description: >-` with the prose on the
 * following indented lines. That is the field the skills page and any agent use
 * to decide whether a skill is relevant, so those skills were effectively
 * invisible.
 *
 * Description keys are read from the fenced frontmatter block only. A
 * `description:` in the markdown body is not a skill description.
 */
export function descriptionFromFrontmatter(content: string): string | null {
  const block = frontmatterBlock(content);
  if (block) {
    const fromBlock = descriptionFromLines(block);
    if (fromBlock) return fromBlock;
  }

  // No frontmatter: first prose line in a short prefix. Never YAML-scan the
  // whole file — a `description:` in the body is not a skill description.
  const prefix = content.split("\n", 40);
  const prose = prefix.filter(Boolean);
  const nonHeader = prose.find((l) => !l.startsWith("#") && !l.startsWith("---") && !l.includes(":"));
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
