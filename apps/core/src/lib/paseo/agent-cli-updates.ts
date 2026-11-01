import fs from "node:fs";
import { resolveBinary } from "../agent-runs/providers";
import { execExternal } from "../exec-external";
import { augmentedPathEnv } from "../../local/process-env";
import { appendSchedulerLog } from "../../domains/scheduler/log";
import { readCliUpdateState, changeCliUpdateState, recordCliUpdateHistory } from "./cli-update-state";
import { acquireCliUpdateLock, cliLockStatus } from "./cli-update-lock";
import type { CliUpdateStatus } from "./cli-update-types";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

interface UpdateCommand {
  label: string;
  bin: string;
  args: string[];
}

function installedTarget(bin: string): string {
  try { return fs.realpathSync(bin).replaceAll("\\", "/"); }
  catch { return bin.replaceAll("\\", "/"); }
}

/** Update only the installation Paseo actually uses; never create a second CLI on PATH. */
export function agentUpdateCommands(): UpdateCommand[] {
  const commands: UpdateCommand[] = [];
  const claude = resolveBinary(["claude"]);
  if (claude) {
    const target = installedTarget(claude);
    if (target.includes("/.local/share/claude/versions/")) commands.push({ label: "Claude", bin: claude, args: ["update"] });
    else if (target.includes("/node_modules/@anthropic-ai/claude-code/")) commands.push({ label: "Claude", bin: "aikido-npm", args: ["install", "-g", "@anthropic-ai/claude-code"] });
  }
  const cursor = resolveBinary(["cursor-agent"]);
  if (cursor && installedTarget(cursor).includes("/.local/share/cursor-agent/versions/")) {
    commands.push({ label: "Cursor", bin: cursor, args: ["update"] });
  }
  const opencode = resolveBinary(["opencode"]);
  if (opencode) {
    const target = installedTarget(opencode);
    if (target.includes("/.opencode/bin/")) commands.push({ label: "OpenCode", bin: opencode, args: ["upgrade"] });
    else if (target.includes("/node_modules/opencode-ai/")) commands.push({ label: "OpenCode", bin: "aikido-npm", args: ["install", "-g", "opencode-ai"] });
  }
  const copilot = resolveBinary(["copilot"]);
  if (copilot && installedTarget(copilot).includes("/node_modules/@github/copilot/")) {
    commands.push({ label: "Copilot", bin: "aikido-npm", args: ["install", "-g", "@github/copilot"] });
  }
  const codex = resolveBinary(["codex"]);
  if (codex && installedTarget(codex).includes("/node_modules/@openai/codex/")) {
    commands.push({ label: "Codex", bin: "aikido-npm", args: ["install", "-g", "@openai/codex"] });
  }
  return commands;
}

export function cliUpdateStatus(): CliUpdateStatus {
  return { ...readCliUpdateState(), checkedAt: Date.now(), installed: agentUpdateCommands().map((command) => command.label), lock: cliLockStatus() };
}

let running = false;

export async function updateAgentClis(now = Date.now()): Promise<void> {
  if (running) return;
  running = true;
  let unlock: (() => void) | null = null;
  try {
    const initial = readCliUpdateState();
    if (!initial.enabled || now - initial.lastAttemptAt < DAY) return;
    unlock = acquireCliUpdateLock();
    if (!unlock) {
      recordCliUpdateHistory({ agent: "All agents", status: "deferred", message: "Another application holds the shared CLI update lock." }, now);
      return;
    }
    const state = readCliUpdateState();
    if (!state.enabled || now - state.lastAttemptAt < DAY) return;
    const env = augmentedPathEnv();
    for (const command of agentUpdateCommands()) {
      // Preferences may have changed while the previous installer was running.
      const latest = readCliUpdateState();
      if (!latest.enabled) return;
      if (latest.pinned.includes(command.label) || latest.skippedUntil[command.label] > Date.now()) {
        recordCliUpdateHistory({ agent: command.label, status: "skipped", message: latest.pinned.includes(command.label) ? "Holding the installed version." : "Skipped for 24 hours." });
        continue;
      }
      try {
        await execExternal(command.bin, command.args, {
          env, timeoutMs: 5 * 60_000, maxBuffer: 256_000, label: `agent-cli:update:${command.label.toLowerCase()}`,
        });
        recordCliUpdateHistory({ agent: command.label, status: "updated", message: "Update command completed." });
        appendSchedulerLog("info", "agent-cli-update", `${command.label} update completed`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        recordCliUpdateHistory({ agent: command.label, status: "failed", message: message.slice(0, 1000) });
        appendSchedulerLog("warn", "agent-cli-update", `${command.label} update failed: ${message}`);
      }
    }
    changeCliUpdateState((current) => ({ ...current, lastAttemptAt: now }));
  } catch (error) {
    appendSchedulerLog("warn", "agent-cli-update", `Update deferred: ${error instanceof Error ? error.message : String(error)}`);
  } finally { try { unlock?.(); } finally { running = false; } }
}

const globalStore = globalThis as typeof globalThis & { __devhubAgentCliUpdateTimer?: ReturnType<typeof setInterval> };
export function startAgentCliUpdates(): void {
  if (globalStore.__devhubAgentCliUpdateTimer || process.env.DEVHUB_AGENT_AUTO_UPDATE === "0") return;
  globalStore.__devhubAgentCliUpdateTimer = setInterval(() => void updateAgentClis(), HOUR);
  globalStore.__devhubAgentCliUpdateTimer.unref();
  void updateAgentClis();
}
