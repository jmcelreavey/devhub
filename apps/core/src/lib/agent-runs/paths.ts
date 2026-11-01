import os from "node:os";
import path from "node:path";
import { getNotesDir } from "../notes/dir";

export function agentRunsDir(): string {
  return process.env.DEVHUB_AGENT_RUNS_DIR?.trim() || path.join(getNotesDir(), ".config", "agent-runs");
}

export function legacyAgentRunsDir(): string | null {
  return process.env.DEVHUB_AGENT_RUNS_DIR?.trim() ? null : path.join(os.tmpdir(), "devhub-agent-runs");
}
