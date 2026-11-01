import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeAtomicNow } from "../atomic-write";
import { acquireCliUpdateLock } from "./cli-update-lock";
import { AGENT_CLI_LABELS, type CliUpdateState, type CliUpdateHistory } from "./cli-update-types";

const DAY = 24 * 60 * 60 * 1000;
const STATE_FILE = path.join(os.homedir(), ".local/state/devhub/agent-cli-updates.json");

export function readCliUpdateState(): CliUpdateState {
  try {
    const value = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as Partial<CliUpdateState>;
    return {
      lastAttemptAt: typeof value.lastAttemptAt === "number" ? value.lastAttemptAt : 0,
      enabled: value.enabled !== false,
      pinned: Array.isArray(value.pinned) ? value.pinned.filter((label) => AGENT_CLI_LABELS.includes(label as typeof AGENT_CLI_LABELS[number])) : [],
      skippedUntil: value.skippedUntil && typeof value.skippedUntil === "object" ? value.skippedUntil : {},
      history: Array.isArray(value.history) ? value.history.slice(-200) : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Couldn’t read agent update preferences. Updates are paused until the file is repaired.", { cause: error });
    return { lastAttemptAt: 0, enabled: true, pinned: [], skippedUntil: {}, history: [] };
  }
}

export function changeCliUpdateState(change: (state: CliUpdateState) => CliUpdateState): CliUpdateState {
  const unlock = acquireCliUpdateLock(STATE_FILE + ".lock");
  if (!unlock) throw new Error("Agent update preferences are being saved. Try again.");
  try {
    const next = change(readCliUpdateState());
    writeAtomicNow(STATE_FILE, JSON.stringify(next));
    return next;
  } finally { unlock(); }
}

export function saveCliUpdatePreferences(change: { enabled?: boolean; agent?: string; pinned?: boolean; skip?: boolean }): void {
  if (change.agent && !AGENT_CLI_LABELS.includes(change.agent as typeof AGENT_CLI_LABELS[number])) throw new Error("Unknown agent CLI.");
  changeCliUpdateState((state) => {
    const next = { ...state, pinned: [...state.pinned], skippedUntil: { ...state.skippedUntil } };
    if (change.enabled !== undefined) next.enabled = change.enabled;
    if (change.agent) {
      if (change.pinned === true && !next.pinned.includes(change.agent)) next.pinned.push(change.agent);
      if (change.pinned === false) next.pinned = next.pinned.filter((label) => label !== change.agent);
      if (change.skip === true) next.skippedUntil[change.agent] = Date.now() + DAY;
      if (change.skip === false) delete next.skippedUntil[change.agent];
    }
    return next;
  });
}

export function recordCliUpdateHistory(entry: Omit<CliUpdateHistory, "at">, at = Date.now()): void {
  changeCliUpdateState((state) => ({ ...state, history: [...state.history, { ...entry, at }].slice(-200) }));
}
