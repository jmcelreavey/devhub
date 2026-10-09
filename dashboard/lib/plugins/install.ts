/**
 * Scoped skill and agent copies for one reviewed plugin.
 * General catalog sync is not used: it prunes unrelated names and treats a
 * logged failure as success.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { formatAgentForTool } from "@/lib/agent/sync-format";
import type { SkillCatalogEntry } from "@/lib/skill-catalog";
import { AGENT_TOOL_DIRS, TOOL_DIRS, copySkillForSync, skillTreesEqualForSync } from "@/lib/sync/skills";
import { hashFile, hashSkillDir, type InspectedAsset } from "./inspect";
import type { TargetProgress } from "./model";

const TOOL_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  opencode: "OpenCode",
  "opencode-config": "OpenCode config",
  "opencode-config-single": "OpenCode skill",
  agents: "Agent Skills",
  antigravity: "Antigravity",
  "ai-skills": "AI skills",
  "config-ai": "Config AI",
};

const TOOL_ORDER = Object.keys(TOOL_LABELS);
/** Offered even before their folders exist; everything else appears once its tool has left a folder behind. */
const ALWAYS_OFFERED = new Set(["claude", "codex", "cursor"]);

export interface SyncTarget {
  id: string;
  label: string;
  skillDir: string | null;
  agentDirs: string[];
  selectedByDefault: boolean;
}

export interface ReceiptFile {
  kind: "skill" | "agent";
  name: string;
  tool: string;
  destination: string;
  hash: string;
}

export interface InstallReceipt {
  pluginId: string;
  sha: string | null;
  planDigest: string;
  files: ReceiptFile[];
}

/**
 * The tool folders a plugin can be copied into, one per distinct skills folder
 * (Codex and ChatGPT share one, so they appear once).
 */
export function listSyncTargets(targetHome: string): SyncTarget[] {
  const claimedSkill = new Set<string>();
  const targets: SyncTarget[] = [];
  for (const id of TOOL_ORDER) {
    const sub = TOOL_DIRS[id];
    if (!sub) continue;
    const skillDir = path.join(targetHome, sub);
    if (claimedSkill.has(skillDir)) continue;
    claimedSkill.add(skillDir);
    const agentDirs: string[] = [];
    const claimedAgent = new Set<string>();
    for (const entry of AGENT_TOOL_DIRS) {
      if (entry.tool !== id && !(id === "codex" && entry.tool === "chatgpt")) continue;
      const dir = path.join(targetHome, entry.subdir);
      if (claimedAgent.has(dir)) continue;
      claimedAgent.add(dir);
      agentDirs.push(dir);
    }
    targets.push({
      id,
      label: TOOL_LABELS[id] ?? id,
      skillDir,
      agentDirs,
      selectedByDefault: id === "claude" || id === "codex",
    });
  }
  return targets;
}

/** Targets worth showing: the common tools, plus any other tool already set up on this machine. */
export function visibleSyncTargets(targetHome: string): SyncTarget[] {
  return listSyncTargets(targetHome).filter((target) => {
    if (ALWAYS_OFFERED.has(target.id)) return true;
    if (!target.skillDir) return false;
    const parent = path.dirname(target.skillDir);
    // A skills folder directly under the home directory (".ai-skills") has no
    // tool folder of its own to look for, so it must exist itself.
    return fs.existsSync(parent !== targetHome ? parent : target.skillDir);
  });
}

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function destinationFingerprint(fileOrDir: string, kind: "skill" | "agent"): string {
  if (!fs.existsSync(fileOrDir)) return "absent";
  if (kind === "agent") return `file:${hashFile(fileOrDir)}`;
  return `dir:${hashSkillDir(fileOrDir)}`;
}

export interface ApplyResult {
  ok: boolean;
  files: ReceiptFile[];
  /** Labels of the tools that received at least one item. */
  targets: string[];
  message: string | null;
  code: "TARGET_WRITE" | "TARGET_CONFLICT" | "VERIFY" | null;
  /** Items written by this attempt and removed again after a failure. */
  rolledBack: number;
  /** Items that could not be proven ours or removed after a failure. */
  leftover: string[];
}

class ApplyError extends Error {
  constructor(readonly code: NonNullable<ApplyResult["code"]>, message: string) {
    super(message);
  }
}

const yieldToLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

export async function applyReviewedAssets(opts: {
  pluginName: string;
  targetHome: string;
  selected: string[];
  skills: InspectedAsset[];
  agents: InspectedAsset[];
  /** Called after every item, so progress shows work that really happened. */
  onProgress?: (rows: TargetProgress[]) => void;
}): Promise<ApplyResult> {
  const targets = visibleSyncTargets(opts.targetHome).filter((target) => opts.selected.includes(target.id));
  const skills = opts.skills.filter((skill) => skill.preview.status === "add" && skill.sourceDir);
  const agents = opts.agents.filter((agent) => agent.preview.status === "add" && agent.sourceFile);
  const rows: TargetProgress[] = targets.map((target) => ({
    id: target.id,
    label: target.label,
    state: "waiting",
    done: 0,
    total: (target.skillDir ? skills.length : 0) + (target.agentDirs.length ? agents.length : 0),
  }));
  const report = () => opts.onProgress?.(rows.map((row) => ({ ...row })));
  const written: ReceiptFile[] = [];
  const used = new Set<string>();
  report();
  try {
    for (const [index, target] of targets.entries()) {
      const row = rows[index];
      row.state = "running";
      report();
      if (target.skillDir) {
        for (const skill of skills) {
          const sourceDir = skill.sourceDir as string;
          const dest = path.join(target.skillDir, skill.preview.name);
          if (fs.existsSync(dest)) throw new ApplyError("TARGET_CONFLICT", `${target.label} already has an item named ${skill.preview.name}.`);
          if (hashSkillDir(sourceDir) !== skill.bytesHash) throw new ApplyError("VERIFY", `Couldn’t verify ${skill.preview.name}.`);
          const entry: SkillCatalogEntry = { name: skill.preview.name, origin: `plugin:${opts.pluginName}`, dir: sourceDir };
          try {
            fs.mkdirSync(target.skillDir, { recursive: true });
            copySkillForSync(entry, dest);
          } catch {
            // Whatever was half-copied is ours, so it is rolled back with the rest.
            written.push({ kind: "skill", name: skill.preview.name, tool: target.id, destination: dest, hash: "" });
            throw new ApplyError("TARGET_WRITE", `${target.label}’s skills folder couldn’t be written.`);
          }
          if (!skillTreesEqualForSync(entry, dest)) {
            written.push({ kind: "skill", name: skill.preview.name, tool: target.id, destination: dest, hash: "" });
            throw new ApplyError("VERIFY", `Couldn’t verify ${skill.preview.name} in ${target.label}.`);
          }
          written.push({ kind: "skill", name: skill.preview.name, tool: target.id, destination: dest, hash: hashSkillDir(dest) });
          used.add(target.label);
          row.done += 1;
          report();
          await yieldToLoop();
        }
      }
      if (target.agentDirs.length) {
        for (const agent of agents) {
          const raw = fs.readFileSync(agent.sourceFile as string, "utf8");
          if (sha256(raw) !== agent.bytesHash) throw new ApplyError("VERIFY", `Couldn’t verify ${agent.preview.name}.`);
          const formatted = formatAgentForTool(raw, target.id);
          const hash = sha256(formatted);
          for (const dir of target.agentDirs) {
            const dest = path.join(dir, `${agent.preview.name}.md`);
            if (fs.existsSync(dest)) throw new ApplyError("TARGET_CONFLICT", `${target.label} already has an item named ${agent.preview.name}.`);
            try {
              fs.mkdirSync(dir, { recursive: true });
              fs.writeFileSync(dest, formatted, { flag: "wx" });
            } catch {
              throw new ApplyError("TARGET_WRITE", `${target.label}’s agents folder couldn’t be written.`);
            }
            written.push({ kind: "agent", name: agent.preview.name, tool: target.id, destination: dest, hash });
            if (hashFile(dest) !== hash) throw new ApplyError("VERIFY", `Couldn’t verify ${agent.preview.name} in ${target.label}.`);
          }
          used.add(target.label);
          row.done += 1;
          report();
          await yieldToLoop();
        }
      }
      row.state = "complete";
      report();
    }
    return { ok: true, files: written, targets: [...used], message: null, code: null, rolledBack: 0, leftover: [] };
  } catch (err) {
    const active = rows.find((row) => row.state === "running");
    if (active) active.state = "failed";
    report();
    const undone = rollbackWritten(written, opts.targetHome);
    return {
      ok: false,
      files: [],
      targets: [],
      message: err instanceof Error ? err.message : "Couldn’t copy plugin files.",
      code: err instanceof ApplyError ? err.code : "TARGET_WRITE",
      rolledBack: undone.removed,
      leftover: undone.leftover,
    };
  }
}

function currentHash(file: ReceiptFile): string | null {
  try {
    const stat = fs.lstatSync(file.destination);
    if (stat.isSymbolicLink()) return null;
    return file.kind === "skill" ? hashSkillDir(file.destination) : hashFile(file.destination);
  } catch {
    return null;
  }
}

function insideHome(destination: string, targetHome: string): boolean {
  const resolved = path.resolve(destination);
  return resolved.startsWith(path.resolve(targetHome) + path.sep);
}

/**
 * Undo this attempt's own writes. A file with no recorded hash was only
 * partly written by us, so it is removed; anything else is removed only while
 * it still matches what was written.
 */
function rollbackWritten(files: ReceiptFile[], targetHome: string): { removed: number; leftover: string[] } {
  let removed = 0;
  const leftover: string[] = [];
  for (const file of [...files].reverse()) {
    try {
      if (!fs.existsSync(file.destination) || !insideHome(file.destination, targetHome)) continue;
      if (file.hash === "" || currentHash(file) === file.hash) {
        fs.rmSync(file.destination, { recursive: true, force: true });
        removed += 1;
      } else {
        leftover.push(file.destination);
      }
    } catch {
      leftover.push(file.destination);
    }
  }
  return { removed, leftover };
}

export function cleanupReceipt(receipt: InstallReceipt, targetHome: string): { removed: string[]; kept: string[] } {
  const removed: string[] = [];
  const kept: string[] = [];
  for (const file of receipt.files) {
    if (!fs.existsSync(file.destination) && !isDanglingLink(file.destination)) continue;
    if (!insideHome(file.destination, targetHome) || currentHash(file) !== file.hash) {
      kept.push(file.destination);
      continue;
    }
    fs.rmSync(file.destination, { recursive: true, force: true });
    removed.push(file.destination);
  }
  return { removed, kept };
}

function isDanglingLink(file: string): boolean {
  try {
    return fs.lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
}
