import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolveOpenCodeBinary } from "@/lib/opencode/command";
import { getDevHubOpenCodePort } from "@/lib/opencode/listen";
import { findInstalledApp } from "@/lib/launch/desktop";
import { EXTRA_PATH_SEGMENTS } from "@/lib/process-env";

function commandOnPath(cmd: string): boolean {
  const which = process.platform === "win32" ? "where" : "which";
  return spawnSync(which, [cmd], { stdio: "ignore" }).status === 0;
}

export function isOpenCodeConfigured(): boolean {
  const bin = resolveOpenCodeBinary();
  if (bin !== "opencode") return fs.existsSync(bin);
  return commandOnPath("opencode");
}

/**
 * True when Claude is available locally — either the `claude` CLI is on PATH
 * or the native Claude desktop app is installed. Gates the Claude sidebar item
 * so it only appears for people who actually have it.
 */
export function isClaudeConfigured(): boolean {
  if (commandOnPath("claude")) return true;
  return findInstalledApp("Claude", "claude") !== null;
}

/**
 * True when Cursor is available locally — the `cursor-agent` CLI, the
 * `cursor` CLI, or the native Cursor app. Gates the Cursor sidebar item
 * so it only appears for people who actually have it.
 */
export function isCursorConfigured(): boolean {
  if (commandOnPath("cursor-agent") || commandOnPath("cursor")) return true;
  return findInstalledApp("Cursor", "cursor") !== null;
}

/**
 * True when ChatGPT is available locally — the `codex` CLI (ChatGPT.app is the
 * Codex desktop; its URL scheme is `codex://`) or `/Applications/ChatGPT.app`.
 * Gates the ChatGPT sidebar item so it only appears for people who actually
 * have it.
 */
export function isChatGPTConfigured(): boolean {
  if (commandOnPath("codex") || commandOnPath("chatgpt")) return true;
  return findInstalledApp("ChatGPT", "codex") !== null;
}

/**
 * True when the Antigravity CLI (`agy`) is on PATH or in a known user bin.
 * No desktop IDE — DevHub always launches the terminal CLI.
 */
export function isAntigravityConfigured(): boolean {
  if (commandOnPath("agy")) return true;
  return EXTRA_PATH_SEGMENTS.some((dir) => fs.existsSync(path.join(dir, "agy")));
}

export function resolveAgyBin(): string | null {
  if (commandOnPath("agy")) return "agy";
  for (const dir of EXTRA_PATH_SEGMENTS) {
    const candidate = path.join(dir, "agy");
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function checkServicePort(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://${host}:${port}`, { timeout: 2_000 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** True when DevHub's lazy OpenCode (session recap) is up and answering. */
async function isRecapOpenCodeActive(): Promise<boolean> {
  const lazy = getDevHubOpenCodePort();
  if (lazy == null) return false;
  return checkServicePort(lazy, "127.0.0.1");
}

/** Which local agent tools are available, for setup gates and provider pickers. */
export async function getPeerServiceGateStatus(): Promise<{
  opencode: boolean;
  claude: boolean;
  cursor: boolean;
  chatgpt: boolean;
  antigravity: boolean;
}> {
  const opencode = isOpenCodeConfigured() || (await isRecapOpenCodeActive());
  const claude = isClaudeConfigured();
  const cursor = isCursorConfigured();
  const chatgpt = isChatGPTConfigured();
  const antigravity = isAntigravityConfigured();
  return { opencode, claude, cursor, chatgpt, antigravity };
}
