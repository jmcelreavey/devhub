/**
 * Defaults for every DevHub → AionUi launch (Implement / Plan / auto-review /
 * schedules / MCP). Prefer Cursor + latest Grok. Permission is the harness's
 * YOLO id from AionCore (`agent_metadata.yolo_id`). Cursor stores `yolo` there
 * even though its session-mode catalog is only agent/plan/ask — sending `agent`
 * still prompts for Grep/search. Keep ACP auto-confirm as a backstop.
 */
import type { AionAssistant } from "./contracts";

/** Known full-auto mode ids from each harness's AionUi agent_metadata.yolo_id / modes. */
export const YOLO_MODE_BY_BACKEND: Record<string, string> = {
  claude: "bypassPermissions",
  codex: "agent-full-access",
  gemini: "yolo",
  opencode: "build",
  antigravity: "yolo",
  aionrs: "yolo",
  cursor: "yolo",
  copilot: "https://agentclientprotocol.com/protocol/session-modes#autopilot",
};

/** Backends that may still raise ACP confirmations even in YOLO — auto-allow them. */
export function backendNeedsPermissionAutoconfirm(backend: string | undefined): boolean {
  const b = (backend || "").toLowerCase();
  return b === "cursor" || b === "copilot";
}

export function resolveYoloPermission(backend: string | undefined, yoloId?: string | null): string {
  const b = (backend || "").toLowerCase() || "aionrs";
  const fromMeta = yoloId?.trim();
  if (fromMeta) return fromMeta;
  return YOLO_MODE_BY_BACKEND[b] || "yolo";
}

/** Map legacy `cursor agent --model` ids onto AionUi Cursor model ids. */
export function mapCursorCliModelToAion(cliModel: string | undefined): string | undefined {
  const raw = cliModel?.trim();
  if (!raw) return undefined;
  if (raw.includes("[") || !raw.startsWith("cursor-")) return raw;
  const lower = raw.toLowerCase();
  if (lower.includes("grok-4.6") && lower.includes("fast")) return "grok-4.6[effort=high,fast=true]";
  if (lower.includes("grok-4.6")) return "grok-4.6[effort=high]";
  if (lower.includes("grok-4.5") && lower.includes("fast")) return "grok-4.5[effort=high,fast=true]";
  if (lower.includes("grok-4.5")) return "grok-4.5[effort=high]";
  // Default Grok: high effort, fast off
  if (lower.includes("grok")) return "grok-4.6[effort=high]";
  return undefined;
}

export function resolveBackgroundCli(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): string {
  return (env.DEVHUB_AGENT_CLI?.trim() || "cursor").toLowerCase();
}

export function resolveCursorAionModel(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): string {
  return (
    env.DEVHUB_AION_CURSOR_MODEL?.trim()
    || mapCursorCliModelToAion(env.DEVHUB_AGENT_CURSOR_MODEL)
    || "grok-4.6[effort=high]"
  );
}

export function resolveAionDispatchDefaults(input: {
  provider?: string;
  model?: string;
  assistants: AionAssistant[];
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}): { provider: string; model?: string; permission: string; autoconfirmPermissions: boolean } {
  const env = input.env ?? process.env;
  const cli = resolveBackgroundCli(env);
  const provider = (input.provider?.trim() || cli);
  const assistant =
    input.assistants.find((a) => a.id === provider)
    ?? input.assistants.find((a) => a.enabled && a.agent?.acp_backend === provider && a.id.startsWith("bare:"))
    ?? input.assistants.find((a) => a.enabled && a.name.toLowerCase() === provider);
  const backend = assistant?.agent?.acp_backend || (assistant?.id.startsWith("bare:") ? undefined : provider) || provider;
  let model = input.model?.trim() || undefined;
  if (!model && (backend === "cursor" || provider === "cursor" || assistant?.id === "bare:a0dfb1ec")) {
    model = resolveCursorAionModel(env);
  }
  const permission = resolveYoloPermission(backend, assistant?.yolo_id);
  return {
    provider: assistant?.id || provider,
    model,
    permission,
    autoconfirmPermissions: backendNeedsPermissionAutoconfirm(backend),
  };
}

export function modelAllowedForAssistant(assistant: AionAssistant, model: string | undefined): boolean {
  if (!model) return true;
  if (!assistant.models.length) return true;
  return assistant.models.includes(model);
}
