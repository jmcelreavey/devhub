/**
 * The last time an agent edited each task note, written by the MCP task_note_update
 * tool when it runs under an agent and read by the Storyboard card. A small
 * sidecar keyed by note path, so a note's own content never has to carry it.
 */
import fs from "node:fs";
import path from "node:path";

export interface AgentNoteUpdate {
  at: string;
  /** The section op the agent applied (set_status, add_media, …). */
  op: string;
  /** The DevHub agent run, when the agent's process knows it. */
  runId?: string;
  /** Agent nesting level from DEVHUB_AGENT_DEPTH (1 = an agent DevHub started). */
  depth?: number;
}

const MAX_ENTRIES = 1000;

export function agentNoteUpdatesFile(notesRoot: string): string {
  return path.join(notesRoot, ".config", "task-note-agent-updates.json");
}

export function readAgentNoteUpdates(notesRoot: string): Record<string, AgentNoteUpdate> {
  try {
    const raw = JSON.parse(fs.readFileSync(agentNoteUpdatesFile(notesRoot), "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Record<string, AgentNoteUpdate> = {};
    for (const [notePath, value] of Object.entries(raw as Record<string, unknown>)) {
      const entry = value as Partial<AgentNoteUpdate> | null;
      if (entry && typeof entry.at === "string" && typeof entry.op === "string") out[notePath] = entry as AgentNoteUpdate;
    }
    return out;
  } catch {
    return {};
  }
}

/** Who is calling, when it is an agent: a DevHub-started agent's MCP process carries DEVHUB_AGENT_DEPTH ≥ 1 (and DEVHUB_AGENT_RUN_ID when known). */
export function agentCallerFromEnv(env: Record<string, string | undefined>): { runId?: string; depth?: number } | null {
  const depth = Number.parseInt(env.DEVHUB_AGENT_DEPTH ?? "", 10);
  const runId = env.DEVHUB_AGENT_RUN_ID?.trim() || undefined;
  if (!runId && !(depth >= 1)) return null;
  return { ...(runId ? { runId } : {}), ...(depth >= 1 ? { depth } : {}) };
}

export function recordAgentNoteUpdate(notesRoot: string, notePath: string, update: AgentNoteUpdate): void {
  const file = agentNoteUpdatesFile(notesRoot);
  const all = readAgentNoteUpdates(notesRoot);
  all[notePath] = update;
  const kept = Object.entries(all).sort(([, a], [, b]) => b.at.localeCompare(a.at)).slice(0, MAX_ENTRIES);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(kept), null, 2) + "\n");
  fs.renameSync(tmp, file);
}
