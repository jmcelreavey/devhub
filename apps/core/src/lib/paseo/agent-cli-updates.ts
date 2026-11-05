import fs from "node:fs";
import path from "node:path";
import { resolveBinary } from "../agent-runs/providers";
import { getResourceRoot } from "../desktop/runtime-paths";
import { execExternal } from "../exec-external";
import { augmentedPathEnv } from "../../local/process-env";
import { appendSchedulerLog } from "../../domains/scheduler/log";
import { readCliUpdateState, changeCliUpdateState, recordCliUpdateHistory } from "./cli-update-state";
import { acquireCliUpdateLock, cliLockStatus } from "./cli-update-lock";
import { checkPaseoUpdate, hasActivePaseoWork, type PaseoUpdate } from "./update";
import { npmCliCandidates } from "../desktop/build-env.mjs";
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
  const pushNpm = (command: UpdateCommand | null) => { if (command) commands.push(command); };
  const claude = resolveBinary(["claude"]);
  if (claude) {
    const target = installedTarget(claude);
    if (target.includes("/.local/share/claude/versions/")) commands.push({ label: "Claude", bin: claude, args: ["update"] });
    else if (target.includes("/node_modules/@anthropic-ai/claude-code/")) pushNpm(npmInstallCommand("Claude", "@anthropic-ai/claude-code"));
  }
  const cursor = resolveBinary(["cursor-agent"]);
  if (cursor && installedTarget(cursor).includes("/.local/share/cursor-agent/versions/")) {
    commands.push({ label: "Cursor", bin: cursor, args: ["update"] });
  }
  const opencode = resolveBinary(["opencode"]);
  if (opencode) {
    const target = installedTarget(opencode);
    if (target.includes("/.opencode/bin/")) commands.push({ label: "OpenCode", bin: opencode, args: ["upgrade"] });
    else if (target.includes("/node_modules/opencode-ai/")) pushNpm(npmInstallCommand("OpenCode", "opencode-ai"));
  }
  const copilot = resolveBinary(["copilot"]);
  if (copilot && installedTarget(copilot).includes("/node_modules/@github/copilot/")) {
    pushNpm(npmInstallCommand("Copilot", "@github/copilot"));
  }
  const gemini = resolveBinary(["gemini"]);
  if (gemini && installedTarget(gemini).includes("/node_modules/@google/gemini-cli/")) {
    pushNpm(npmInstallCommand("Gemini", "@google/gemini-cli"));
  }
  const codex = resolveBinary(["codex"]);
  if (codex) {
    const command = codexUpdateCommand(codex);
    if (command) commands.push(command);
  }
  return commands;
}

/**
 * Global npm installs run as plain `node npm-cli.js` beside the running Node —
 * never by the `npm` name, which Safe-Chain shims. Updates must not be
 * scannable, blockable, or breakable by the wrapper. Null when this toolchain
 * ships no npm, in which case the CLI is left out rather than guessed at.
 */
export function npmInstallCommand(label: string, pkg: string, execPath = process.execPath, existsSync: (file: string) => boolean = fs.existsSync): UpdateCommand | null {
  const cli = npmCliCandidates(execPath).find((candidate) => existsSync(candidate)) ?? null;
  return cli ? { label, bin: execPath, args: [cli, "install", "-g", pkg] } : null;
}

/**
 * Standalone Codex lives under ~/.codex and self-updates via `codex update`;
 * the npm layout goes through the global npm install like the other npm CLIs.
 * Unknown layouts are left alone rather than guessed at.
 */
export function codexUpdateCommand(codexBin: string, execPath = process.execPath, existsSync: (file: string) => boolean = fs.existsSync): UpdateCommand | null {
  const target = installedTarget(codexBin);
  if (target.includes("/.codex/") || target.includes("/packages/standalone/")) {
    return { label: "Codex", bin: codexBin, args: ["update"] };
  }
  if (target.includes("/node_modules/@openai/codex/")) {
    return npmInstallCommand("Codex", "@openai/codex", execPath, existsSync);
  }
  return null;
}

/** An eligible Paseo release worth installing, or null when there is nothing to do. */
export function paseoAutoUpdateTarget(update: Pick<PaseoUpdate, "canUpdate" | "installable">): string | null {
  return update.canUpdate && update.installable ? update.installable : null;
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
    await updatePaseoDaemon(env);
  } catch (error) {
    appendSchedulerLog("warn", "agent-cli-update", `Update deferred: ${error instanceof Error ? error.message : String(error)}`);
  } finally { try { unlock?.(); } finally { running = false; } }
}

/**
 * Bring the managed Paseo daemon itself up to an eligible release, with the
 * same guards as the manual update: master switch, 24-hour release age, and
 * no active chats (a daemon restart mid-chat is a data-loss shaped event).
 * Silent when there is nothing eligible — history and the scheduler log only
 * record attempts and their outcomes.
 */
export async function updatePaseoDaemon(env: NodeJS.ProcessEnv): Promise<void> {
  let update: PaseoUpdate;
  try {
    update = await checkPaseoUpdate();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendSchedulerLog("warn", "paseo-auto-update", `Update check failed: ${message}`);
    return;
  }
  const target = paseoAutoUpdateTarget(update);
  if (!target) return;
  try {
    if (await hasActivePaseoWork()) {
      recordCliUpdateHistory({ agent: "Paseo", status: "deferred", message: "Active chats running; will retry on the next daily check." });
      appendSchedulerLog("info", "paseo-auto-update", `Paseo ${target} deferred: active chats running`);
      return;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendSchedulerLog("warn", "paseo-auto-update", `Could not verify idle chats: ${message}`);
    return;
  }
  try {
    await execExternal(process.execPath, [path.join(getResourceRoot(), "scripts", "install-paseo.mjs"), "--update", target], {
      env, timeoutMs: 10 * 60_000, maxBuffer: 2_000_000, label: "paseo:auto-update",
    });
    recordCliUpdateHistory({ agent: "Paseo", status: "updated", message: `Updated to ${target}.` });
    appendSchedulerLog("info", "paseo-auto-update", `Paseo updated to ${target}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordCliUpdateHistory({ agent: "Paseo", status: "failed", message: message.slice(0, 1000) });
    appendSchedulerLog("warn", "paseo-auto-update", `Paseo update failed: ${message}`);
  }
}

const globalStore = globalThis as typeof globalThis & { __devhubAgentCliUpdateTimer?: ReturnType<typeof setInterval> };
export function startAgentCliUpdates(): void {
  if (globalStore.__devhubAgentCliUpdateTimer || process.env.DEVHUB_AGENT_AUTO_UPDATE === "0") return;
  globalStore.__devhubAgentCliUpdateTimer = setInterval(() => void updateAgentClis(), HOUR);
  globalStore.__devhubAgentCliUpdateTimer.unref();
  void updateAgentClis();
}
