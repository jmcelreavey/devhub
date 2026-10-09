import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getCheckoutRoot, getResourceRoot } from "@/lib/content/dirs";
import { readSharedMcpServer, substituteRepoRoot, type Json, type SharedMcpServer } from "@/lib/sync/mcp";
import { applyCursorAcpServerOverlay } from "@/lib/mcp/cursor-acp-surface";
import type { PaseoAgentConfig } from "@getpaseo/client";
import { runtimeMcpServers } from "@/lib/plugins/runtime-mcp";

type McpServers = NonNullable<PaseoAgentConfig["mcpServers"]>;

/**
 * Full-auto mode per Paseo provider. Cursor's ACP catalog is agent/plan/ask —
 * "agent" still raises permission prompts, so it also needs auto-confirm.
 */
const YOLO_MODE: Record<string, string> = {
  claude: "bypassPermissions",
  codex: "full-access",
  opencode: "build",
  cursor: "agent",
  gemini: "yolo",
  copilot: "allow-all",
};

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

/** DEVHUB_AGENT_CLI, with the older `chatgpt` alias mapped onto Paseo's `codex`. */
export function resolveBackgroundCli(env: Env = process.env): string {
  const raw = (env.DEVHUB_AGENT_CLI?.trim() || "cursor").toLowerCase();
  return raw === "chatgpt" ? "codex" : raw;
}

/** Map `cursor agent --model` ids (DEVHUB_AGENT_CURSOR_MODEL) onto Cursor ACP model ids. */
export function mapCursorCliModel(cliModel: string | undefined): string | undefined {
  const raw = cliModel?.trim();
  if (!raw) return undefined;
  if (raw.includes("[") || !raw.startsWith("cursor-")) return raw;
  const lower = raw.toLowerCase();
  if (lower.includes("grok-4.6") && lower.includes("fast")) return "grok-4.6[effort=high,fast=true]";
  if (lower.includes("grok-4.6")) return "grok-4.6[effort=high]";
  if (lower.includes("grok-4.5") && lower.includes("fast")) return "grok-4.5[effort=high,fast=true]";
  if (lower.includes("grok-4.5")) return "grok-4.5[effort=high]";
  if (lower.includes("grok")) return "grok-4.6[effort=high]";
  return undefined;
}

/** OpenCode's own default, as the Setup page promises: `model` in opencode.json. */
function opencodeConfigModel(env: Env): string | undefined {
  const configHome = env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), ".config");
  try {
    const model = JSON.parse(fs.readFileSync(path.join(configHome, "opencode", "opencode.json"), "utf8"))?.model;
    return typeof model === "string" && model.trim() ? model.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Model when the caller didn't pick one. Paseo's own fallback picks from its
 * catalog, which can name a model the user's OpenCode setup doesn't have.
 */
export function defaultModelFor(provider: string, env: Env = process.env): string | undefined {
  if (provider === "cursor") return mapCursorCliModel(env.DEVHUB_AGENT_CURSOR_MODEL) || "grok-4.6[effort=high]";
  if (provider === "opencode") return env.DEVHUB_AGENT_OPENCODE_MODEL?.trim() || opencodeConfigModel(env);
  return undefined;
}

export const AUTOCONFIRM_PROVIDERS: ReadonlySet<string> = new Set(["cursor", "copilot"]);

export interface PaseoLaunch {
  provider: string;
  model?: string;
  config: PaseoAgentConfig;
  env: Record<string, string>;
  autoconfirmPermissions: boolean;
}

/**
 * Cursor's parameterized ids (`grok-4.6[effort=high,fast=true]`) carry thinking
 * and fast mode inline; Paseo takes them as separate fields.
 */
export function splitParameterizedModel(model: string): { model: string; thinking?: string; fast?: boolean } {
  const match = /^([^[\]]+)\[([^\]]*)\]$/.exec(model.trim());
  if (!match) return { model: model.trim() };
  const params = new Map(match[2].split(",").map((pair) => pair.split("=").map((part) => part.trim()) as [string, string]));
  const thinking = params.get("effort") ?? params.get("reasoning_effort");
  const fast = params.get("fast");
  return { model: match[1].trim(), ...(thinking ? { thinking } : {}), ...(fast ? { fast: fast === "true" } : {}) };
}

function toPaseoMcp(server: SharedMcpServer): McpServers[string] | null {
  if (server.url) {
    return { type: server.type === "sse" ? "sse" : "http", url: server.url, ...(server.headers ? { headers: server.headers } : {}) };
  }
  if (!server.command) return null;
  return { type: "stdio", command: server.command, ...(server.args ? { args: server.args } : {}), ...(server.env ? { env: server.env } : {}) };
}

/**
 * Only the servers DevHub guarantees. Harnesses already load the user's own
 * MCP config (Claude reads user settings), so re-injecting everything would
 * duplicate servers and push Cursor past its tool cap.
 */
export function paseoMcpServers(names: readonly string[], repoRoot = getCheckoutRoot() ?? getResourceRoot(), includeRuntime = false): McpServers {
  const out: McpServers = includeRuntime ? runtimeMcpServers() : {};
  for (const name of names) {
    const raw = readSharedMcpServer(repoRoot, name);
    if (!raw || raw.enabled === false) continue;
    const server = toPaseoMcp(substituteRepoRoot(raw as unknown as Json, repoRoot) as SharedMcpServer);
    if (server) out[name] = server;
  }
  return out;
}

export function resolvePaseoLaunch(input: { provider: string; model?: string; mcpNames: readonly string[]; depth: number; env?: Env; runtimePlugins?: boolean }): PaseoLaunch {
  const env = input.env ?? process.env;
  const requested = input.provider.trim().toLowerCase();
  const provider = requested === "chatgpt" ? "codex" : requested;
  if (!/^[a-z][a-z0-9-]*$/.test(provider)) throw new Error(`"${input.provider}" is not a Paseo provider id.`);
  const model = input.model?.trim() || defaultModelFor(provider, env);
  // Paseo requires provider/model; "default" asks the provider for its own default.
  const split = model ? splitParameterizedModel(model) : undefined;
  // The DevHub MCP refuses nested dispatch past DEVHUB_AGENT_MAX_DEPTH; it reads this from its env.
  const depthEnv = { DEVHUB_AGENT_DEPTH: String(input.depth + 1) };
  const mcpServers = Object.fromEntries(Object.entries(paseoMcpServers(input.mcpNames, undefined, input.runtimePlugins)).map(([name, server]) => {
    if (server.type !== "stdio") return [name, server];
    // Cursor drops tools past ~190; it gets the same slimmed DevHub catalog as its synced mcp.json.
    const shaped = provider === "cursor" ? applyCursorAcpServerOverlay(name, server as unknown as Json) as typeof server : server;
    return [name, { ...shaped, env: { ...shaped.env, ...depthEnv } }];
  }));
  const config: PaseoAgentConfig = {
    provider: `${provider}/${split?.model || "default"}`,
    ...(YOLO_MODE[provider] ? { modeId: YOLO_MODE[provider] } : {}),
    ...(split?.thinking ? { thinkingOptionId: split.thinking } : {}),
    featureValues: {
      ...(AUTOCONFIRM_PROVIDERS.has(provider) ? { auto_accept: true } : {}),
      ...(split?.fast !== undefined ? { fast: split.fast } : {}),
    },
    ...(Object.keys(mcpServers).length ? { mcpServers } : {}),
  };
  // Also on the agent itself, so user-level DevHub MCP entries the harness loads inherit it.
  return { provider, model, config, env: depthEnv, autoconfirmPermissions: AUTOCONFIRM_PROVIDERS.has(provider) };
}
