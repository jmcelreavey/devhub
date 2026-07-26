import fs from "node:fs";

/**
 * Transforms canonical agents/shared/*.md into per-tool layouts at sync time.
 *
 * Canonical source (repo): name, description, mode: subagent, readonly — no tools/model.
 * OpenCode targets: permission block (edit/bash), no deprecated tools or readonly.
 * Cursor / Codex / Claude / config-ai: readonly + description; no OpenCode-only fields.
 */

export type AgentSyncTool = "opencode" | "cursor" | "generic";

export function agentSyncToolFamily(tool: string): AgentSyncTool {
  if (tool === "opencode") return "opencode";
  if (tool === "cursor") return "cursor";
  return "generic";
}

export interface ParsedAgentFile {
  frontmatter: Record<string, string>;
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function skipNestedBlock(line: string, inBlock: boolean): boolean {
  if (inBlock) {
    if (/^\S/.test(line) && !/^\s/.test(line)) return false;
    return true;
  }
  return false;
}

/** Parse flat YAML frontmatter; skips nested `tools:` / `permission:` blocks. */
export function parseAgentMarkdown(content: string): ParsedAgentFile | null {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return null;

  const frontmatter: Record<string, string> = {};
  let nestedBlock: "tools" | "permission" | null = null;
  const fmBody = match[1];

  for (const line of fmBody.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^tools:\s*$/.test(trimmed)) {
      nestedBlock = "tools";
      continue;
    }
    if (/^permission:\s*$/.test(trimmed)) {
      nestedBlock = "permission";
      if (/edit:\s*deny/i.test(fmBody)) frontmatter.readonly = "true";
      continue;
    }
    if (nestedBlock) {
      if (!skipNestedBlock(line, true)) nestedBlock = null;
      else continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) frontmatter[kv[1]] = kv[2].trim();
  }

  return { frontmatter, body: match[2] };
}

function parseBoolean(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.toLowerCase();
  return v === "true" || v === "yes";
}

function serializeFrontmatter(lines: string[]): string {
  return `---\n${lines.join("\n")}\n---\n\n`;
}

function opencodePermissionLines(readonly: boolean): string[] {
  if (readonly) {
    return ["permission:", "  edit: deny", "  bash: allow"];
  }
  return ["permission:", "  edit: allow", "  bash: allow"];
}

/** Format canonical agent markdown for a sync target tool family. */
export function formatAgentForTool(content: string, tool: string): string {
  const parsed = parseAgentMarkdown(content);
  if (!parsed) return content;

  const { frontmatter, body } = parsed;
  const name = frontmatter.name?.replace(/^['"]|['"]$/g, "");
  const description = frontmatter.description?.replace(/^['"]|['"]$/g, "");
  const readonly = parseBoolean(frontmatter.readonly);
  const family = agentSyncToolFamily(tool);

  const lines: string[] = [];

  if (name) lines.push(`name: ${name}`);
  if (description) lines.push(`description: ${description}`);

  if (family === "opencode") {
    lines.push("mode: subagent");
    lines.push(...opencodePermissionLines(readonly));
  } else {
    lines.push(`readonly: ${readonly}`);
    lines.push("is_background: false");
  }

  return serializeFrontmatter(lines) + body.replace(/^\n+/, "");
}

/** True when repo file still uses legacy tools:/model: blocks (should be cleaned up). */
export function agentHasLegacyFrontmatter(content: string): boolean {
  const parsed = parseAgentMarkdown(content);
  if (!parsed) return false;
  const keys = Object.keys(parsed.frontmatter);
  return keys.includes("model") || /^tools:\s*$/m.test(content.match(FRONTMATTER_RE)?.[1] ?? "");
}

/** Malformed frontmatter from bad edits (e.g. `readonly: true---` without newline). */
export function agentFrontmatterMalformed(content: string): boolean {
  return /^readonly:\s*(?:true|false)---/m.test(content) || !FRONTMATTER_RE.test(content);
}

/** True when local tool copy matches repo catalog semantically (ignores per-tool frontmatter). */
export function agentCatalogContentEqual(localPath: string, repoPath: string): boolean {
  try {
    const localRaw = fs.readFileSync(localPath, "utf-8");
    const repoRaw = fs.readFileSync(repoPath, "utf-8");
    return canonicalizeAgentMarkdown(localRaw) === canonicalizeAgentMarkdown(repoRaw);
  } catch {
    return false;
  }
}

/** Normalize any tool-local agent file into canonical repo shape. */
export function canonicalizeAgentMarkdown(content: string): string {
  const parsed = parseAgentMarkdown(content);
  if (!parsed) return content;

  const { frontmatter, body } = parsed;
  const slug = frontmatter.name?.replace(/^['"]|['"]$/g, "");
  const description = frontmatter.description?.replace(/^['"]|['"]$/g, "");
  const readonly = parseBoolean(frontmatter.readonly);

  const lines: string[] = [];
  if (slug) lines.push(`name: ${slug}`);
  if (description) lines.push(`description: ${description}`);
  lines.push("mode: subagent");
  lines.push(`readonly: ${readonly}`);

  return serializeFrontmatter(lines) + body.replace(/^\n+/, "");
}
