/**
 * Pull persona content back from a specific tool's config into the repo
 * sources. Each tool's persona/identity sit between marker comments injected
 * by sync-persona.ts (and Cursor rules under ~/.cursor/rules/devhub-persona-*.mdc) —
 * we read marker blocks back and overwrite the source
 * files (persona/shared-persona.md, persona/identity.txt).
 *
 * Only one tool at a time, picked explicitly. No-op if the requested tool's
 * file or markers are missing.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MARKER_START = "<!-- ai-dotfiles:shared-persona:start -->";
const MARKER_END = "<!-- ai-dotfiles:shared-persona:end -->";
const IDENTITY_MARKER_START = "<!-- ai-dotfiles:identity:start -->";
const IDENTITY_MARKER_END = "<!-- ai-dotfiles:identity:end -->";

export type PersonaSource = "shared-persona" | "identity";
export type PersonaToolId = "claude" | "codex" | "opencode" | "cursor";

interface ToolFile {
  id: PersonaToolId;
  label: string;
  filepath: (home: string) => string;
}

const TOOL_FILES: ToolFile[] = [
  { id: "claude", label: "Claude", filepath: (home) => path.join(home, ".claude/CLAUDE.md") },
  { id: "codex", label: "Codex", filepath: (home) => path.join(home, ".codex/AGENTS.md") },
  { id: "opencode", label: "OpenCode", filepath: (home) => path.join(home, ".opencode/AGENTS.md") },
  { id: "cursor", label: "Cursor", filepath: (home) => path.join(home, ".cursor/.cursorrules") },
];

interface SourceFile {
  id: PersonaSource;
  filepath: (repoRoot: string) => string;
  startMarker: string;
  endMarker: string;
}

const SOURCE_FILES: SourceFile[] = [
  {
    id: "shared-persona",
    filepath: (repoRoot) => path.join(repoRoot, "persona", "shared-persona.md"),
    startMarker: MARKER_START,
    endMarker: MARKER_END,
  },
  {
    id: "identity",
    filepath: (repoRoot) => path.join(repoRoot, "persona", "identity.txt"),
    startMarker: IDENTITY_MARKER_START,
    endMarker: IDENTITY_MARKER_END,
  },
];

function toolById(id: string): ToolFile | undefined {
  return TOOL_FILES.find((t) => t.id === id);
}

function sourceById(id: string): SourceFile | undefined {
  return SOURCE_FILES.find((s) => s.id === id);
}

/** Pull the block between `start` and `end` markers out of `content`. */
function extractBlock(content: string, start: string, end: string): string | null {
  const startIdx = content.indexOf(start);
  if (startIdx === -1) return null;
  const afterStart = startIdx + start.length;
  const endIdx = content.indexOf(end, afterStart);
  if (endIdx === -1) return null;
  // Strip the single leading + trailing newline that sync-persona writes
  // around the payload.
  let block = content.slice(afterStart, endIdx);
  if (block.startsWith("\n")) block = block.slice(1);
  if (block.endsWith("\n")) block = block.slice(0, -1);
  return block;
}

export interface ReadPersonaBlockResult {
  tool: PersonaToolId;
  toolLabel: string;
  toolFile: string;
  source: PersonaSource;
  sourceFile: string;
  toolBlock: string | null;
  sourceContent: string;
  toolExists: boolean;
  sourceExists: boolean;
  inSync: boolean;
}

export function readPersonaBlock(
  repoRoot: string,
  toolId: string,
  source: string,
): ReadPersonaBlockResult | { error: string } {
  const tool = toolById(toolId);
  const src = sourceById(source);
  if (!tool) return { error: `Unknown tool '${toolId}'` };
  if (!src) return { error: `Unknown source '${source}'` };
  const home = os.homedir();
  const toolFile = tool.filepath(home);
  const sourceFile = src.filepath(repoRoot);

  const toolExists = fs.existsSync(toolFile);
  const sourceExists = fs.existsSync(sourceFile);
  const toolBlock = toolExists
    ? extractBlock(fs.readFileSync(toolFile, "utf-8"), src.startMarker, src.endMarker)
    : null;
  const sourceContent = sourceExists ? fs.readFileSync(sourceFile, "utf-8") : "";

  return {
    tool: tool.id,
    toolLabel: tool.label,
    toolFile,
    source: src.id,
    sourceFile,
    toolBlock,
    sourceContent,
    toolExists,
    sourceExists,
    inSync: toolBlock !== null && toolBlock === sourceContent.replace(/\n+$/, "").replace(/^\n+/, ""),
  };
}

export interface CollectPersonaOptions {
  emit: (line: string) => void;
  repoRoot: string;
  tool: string;
  /** Which sources to pull back. Defaults to both. */
  sources?: PersonaSource[];
  dryRun?: boolean;
}

export async function collectPersona(opts: CollectPersonaOptions): Promise<number> {
  const { emit, repoRoot } = opts;
  const tool = toolById(opts.tool);
  if (!tool) {
    emit(`ERROR: Unknown tool '${opts.tool}'. Options: ${TOOL_FILES.map((t) => t.id).join(", ")}`);
    return 1;
  }
  const home = os.homedir();
  const toolFile = tool.filepath(home);
  if (!fs.existsSync(toolFile)) {
    emit(`ERROR: Tool file not found: ${toolFile}`);
    return 1;
  }
  const toolContent = fs.readFileSync(toolFile, "utf-8");

  const wantSources: PersonaSource[] = opts.sources?.length
    ? (opts.sources.filter((s) => sourceById(s)) as PersonaSource[])
    : SOURCE_FILES.map((s) => s.id);

  emit(`Pulling persona from ${tool.label} (${toolFile})`);
  if (opts.dryRun) emit("(DRY RUN — no changes will be made)");

  let updated = 0;
  for (const sid of wantSources) {
    const src = sourceById(sid)!;
    const block = extractBlock(toolContent, src.startMarker, src.endMarker);
    if (block === null) {
      emit(`  SKIP ${sid}: markers not found in ${toolFile}`);
      continue;
    }
    const sourceFile = src.filepath(repoRoot);
    const existing = fs.existsSync(sourceFile) ? fs.readFileSync(sourceFile, "utf-8") : "";
    const next = block.endsWith("\n") ? block : block + "\n";
    if (existing === next) {
      emit(`  UNCHANGED: ${sid}`);
      continue;
    }
    if (opts.dryRun) {
      emit(`  WOULD UPDATE: ${sourceFile}`);
      updated++;
      continue;
    }
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(sourceFile, next, "utf-8");
    emit(`  UPDATED: ${sourceFile}`);
    updated++;
  }

  emit(`Done. ${updated} source file(s) updated.`);
  return 0;
}

export function listPersonaTools(): { id: PersonaToolId; label: string }[] {
  return TOOL_FILES.map(({ id, label }) => ({ id, label }));
}

export function listPersonaSources(): { id: PersonaSource; label: string }[] {
  return SOURCE_FILES.map((s) => ({
    id: s.id,
    label: s.id === "shared-persona" ? "Shared persona" : "Identity",
  }));
}
