/**
 * Sync persona sources into tool configs and Cursor rules.
 *
 * Reads persona/shared-persona.md and persona/identity.txt from the repo
 * and injects them between marker comments. Anything outside markers is preserved.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  IDENTITY_MARKER_END,
  IDENTITY_MARKER_START,
  MARKER_END,
  MARKER_START,
  extractPersonaBlock,
} from "./persona-meta";

export interface SyncPersonaOptions {
  dryRun?: boolean;
  /** Limit to a specific tool. */
  tool?: string;
  emit: (line: string) => void;
  repoRoot: string;
}

interface Target {
  id: string;
  filepath: string;
}

function buildTargets(repoRoot: string): Target[] {
  const home = os.homedir();
  return [
    { id: "claude", filepath: path.join(home, ".claude/CLAUDE.md") },
    { id: "codex", filepath: path.join(home, ".codex/AGENTS.md") },
    { id: "opencode", filepath: path.join(home, ".opencode/AGENTS.md") },
    { id: "cursor", filepath: path.join(home, ".cursor/.cursorrules") },
    { id: "generic-agents", filepath: path.join(repoRoot, "AGENTS.md") },
  ];
}

function injectBetweenMarkers(
  target: string,
  payload: string,
  startMarker: string,
  endMarker: string,
  dryRun: boolean,
  emit: (line: string) => void,
): boolean {
  const block = `${startMarker}\n${payload}\n${endMarker}`;
  if (!fs.existsSync(target)) {
    if (dryRun) {
      emit(`  WOULD CREATE: ${target}`);
      return true;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${block}\n`, "utf-8");
    emit(`  CREATED: ${target}`);
    return true;
  }

  const original = fs.readFileSync(target, "utf-8");
  let next: string;
  if (original.includes(startMarker) && original.includes(endMarker)) {
    const [before, rest] = original.split(startMarker, 2);
    const [, after] = rest.split(endMarker, 2);
    if (after === undefined) return false;
    next = `${before}${block}${after}`;
  } else {
    const prepend =
      path.basename(target) === "AGENTS.md" &&
      (startMarker === IDENTITY_MARKER_START || startMarker === MARKER_START);
    next = prepend ? `${block}\n\n${original}` : `${original}\n\n${block}\n`;
  }

  if (next === original) {
    emit(`  UNCHANGED: ${target}`);
    return false;
  }
  if (dryRun) {
    emit(`  WOULD UPDATE: ${target}`);
    return true;
  }
  fs.writeFileSync(target, next, "utf-8");
  emit(`  UPDATED: ${target}`);
  return true;
}

function writeCursorRuleMdc(
  filepath: string,
  description: string,
  body: string,
  dryRun: boolean,
  emit: (line: string) => void,
): boolean {
  const content =
    `---\n` +
    `description: ${description}\n` +
    `alwaysApply: true\n` +
    `---\n\n` +
    `${body.trim()}\n`;
  const exists = fs.existsSync(filepath);
  const prev = exists ? fs.readFileSync(filepath, "utf-8") : "";
  if (prev === content) {
    emit(`  UNCHANGED: ${filepath}`);
    return false;
  }
  if (dryRun) {
    emit(`  WOULD ${exists ? "UPDATE" : "CREATE"}: ${filepath}`);
    return true;
  }
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, content, "utf-8");
  emit(`  ${exists ? "UPDATED" : "CREATED"}: ${filepath}`);
  return true;
}

/** Repo AGENTS.md: L0 identity block before L1 shared-persona, then unmarked project rules. */
function normalizeRepoAgentsOrder(
  agentsPath: string,
  dryRun: boolean,
  emit: (line: string) => void,
): void {
  if (!fs.existsSync(agentsPath)) return;
  const original = fs.readFileSync(agentsPath, "utf-8");
  const identity = extractPersonaBlock(
    original,
    IDENTITY_MARKER_START,
    IDENTITY_MARKER_END,
  );
  const shared = extractPersonaBlock(original, MARKER_START, MARKER_END);
  if (!identity || !shared) return;

  const stripBlock = (text: string, start: string, end: string): string => {
    const s = text.indexOf(start);
    if (s === -1) return text;
    const e = text.indexOf(end, s);
    if (e === -1) return text;
    return (text.slice(0, s) + text.slice(e + end.length)).replace(/\n{3,}/g, "\n\n");
  };

  let rest = stripBlock(original, IDENTITY_MARKER_START, IDENTITY_MARKER_END);
  rest = stripBlock(rest, MARKER_START, MARKER_END).trim();
  const identityBlock = `${IDENTITY_MARKER_START}\n${identity}\n${IDENTITY_MARKER_END}`;
  const sharedBlock = `${MARKER_START}\n${shared}\n${MARKER_END}`;
  const next = `${identityBlock}\n\n${sharedBlock}\n\n${rest}\n`;

  if (next === original) return;
  if (dryRun) {
    emit(`  WOULD REORDER: ${agentsPath}`);
    return;
  }
  fs.writeFileSync(agentsPath, next, "utf-8");
  emit(`  REORDERED: ${agentsPath} (L0 before L1)`);
}

function syncCursorRules(
  identityContent: string,
  personaContent: string,
  dryRun: boolean,
  emit: (line: string) => void,
): number {
  const home = os.homedir();
  const rulesDir = path.join(home, ".cursor", "rules");
  let n = 0;
  emit("[cursor-rules]");
  if (identityContent) {
    if (
      writeCursorRuleMdc(
        path.join(rulesDir, "devhub-persona-identity.mdc"),
        "DevHub L0 identity (synced from persona/identity.txt)",
        identityContent,
        dryRun,
        emit,
      )
    ) {
      n++;
    }
  }
  if (
    writeCursorRuleMdc(
      path.join(rulesDir, "devhub-persona-shared.mdc"),
      "DevHub L1 shared engineering standards (synced from persona/shared-persona.md)",
      personaContent,
      dryRun,
      emit,
    )
  ) {
    n++;
  }
  return n;
}

export async function syncPersona(opts: SyncPersonaOptions): Promise<number> {
  const { emit, repoRoot } = opts;
  const personaFile = path.join(repoRoot, "persona", "shared-persona.md");
  const identityFile = path.join(repoRoot, "persona", "identity.txt");

  if (!fs.existsSync(personaFile)) {
    emit(`ERROR: Persona file not found: ${personaFile}`);
    return 1;
  }
  const personaContent = fs.readFileSync(personaFile, "utf-8");
  const identityContent = fs.existsSync(identityFile)
    ? fs.readFileSync(identityFile, "utf-8")
    : "";

  let targets = buildTargets(repoRoot);
  if (opts.tool) {
    targets = targets.filter((t) => t.id === opts.tool);
    if (targets.length === 0 && opts.tool !== "cursor-rules") {
      emit(`ERROR: Unknown tool '${opts.tool}'.`);
      return 1;
    }
  }

  emit("Syncing persona to native configs...");
  if (opts.dryRun) emit("(DRY RUN — no changes will be made)");

  let updated = 0;
  for (const t of targets) {
    emit(`[${t.id}]`);
    if (identityContent) {
      if (
        injectBetweenMarkers(
          t.filepath,
          identityContent,
          IDENTITY_MARKER_START,
          IDENTITY_MARKER_END,
          opts.dryRun ?? false,
          emit,
        )
      ) {
        updated++;
      }
    }
    if (
      injectBetweenMarkers(
        t.filepath,
        personaContent,
        MARKER_START,
        MARKER_END,
        opts.dryRun ?? false,
        emit,
      )
    ) {
      updated++;
    }
    if (t.id === "generic-agents") {
      normalizeRepoAgentsOrder(t.filepath, opts.dryRun ?? false, emit);
    }
  }

  if (!opts.tool || opts.tool === "cursor-rules") {
    updated += syncCursorRules(
      identityContent,
      personaContent,
      opts.dryRun ?? false,
      emit,
    );
  }

  emit(`Done. ${updated} file(s) updated.`);
  return 0;
}
