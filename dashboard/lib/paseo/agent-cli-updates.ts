import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveBinary } from "@/lib/agent-runs/providers";
import { execExternal } from "@/lib/exec-external";
import { augmentedPathEnv } from "@/lib/process-env";
import { appendSchedulerLog } from "@/lib/scheduler-log";
import { hasActivePaseoWork } from "./update";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const STATE_FILE = path.join(os.homedir(), ".local/state/devhub/agent-cli-updates.json");

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

function lastAttempt(): number {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (value && typeof value === "object" && "lastAttemptAt" in value) {
      const time = value.lastAttemptAt;
      return typeof time === "number" && Number.isFinite(time) ? time : 0;
    }
  } catch { /* First run or damaged state: check again. */ }
  return 0;
}

function recordAttempt(now: number): void {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const temp = `${STATE_FILE}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify({ lastAttemptAt: now }), { mode: 0o600 });
    fs.renameSync(temp, STATE_FILE);
  } finally { fs.rmSync(temp, { force: true }); }
}

let running = false;

export async function updateAgentClis(now = Date.now()): Promise<void> {
  if (running || now - lastAttempt() < DAY) return;
  running = true;
  try {
    // A disconnected daemon cannot confirm that its agents are idle.
    if (await hasActivePaseoWork()) return;
    const env = augmentedPathEnv();
    for (const command of agentUpdateCommands()) {
      if (await hasActivePaseoWork()) return;
      try {
        await execExternal(command.bin, command.args, {
          env, timeoutMs: 5 * 60_000, maxBuffer: 256_000, label: `agent-cli:update:${command.label.toLowerCase()}`,
        });
        appendSchedulerLog("info", "agent-cli-update", `${command.label} update completed`);
      } catch (error) {
        appendSchedulerLog("warn", "agent-cli-update", `${command.label} update failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    recordAttempt(now);
  } catch (error) {
    appendSchedulerLog("warn", "agent-cli-update", `Update deferred: ${error instanceof Error ? error.message : String(error)}`);
  } finally { running = false; }
}

const globalStore = globalThis as typeof globalThis & { __devhubAgentCliUpdateTimer?: ReturnType<typeof setInterval> };
export function startAgentCliUpdates(): void {
  if (globalStore.__devhubAgentCliUpdateTimer || process.env.DEVHUB_AGENT_AUTO_UPDATE === "0") return;
  globalStore.__devhubAgentCliUpdateTimer = setInterval(() => void updateAgentClis(), HOUR);
  globalStore.__devhubAgentCliUpdateTimer.unref();
  void updateAgentClis();
}
