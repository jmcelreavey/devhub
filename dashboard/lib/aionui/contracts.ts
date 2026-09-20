import { z } from "zod";

// AionUi v2.2.2 / AionCore v0.2.2. Keep wire names inside this boundary.
export const aionRuntimeSchema = z.object({
  state: z.enum(["idle", "starting", "running", "cancelling", "restarting", "waiting_confirmation"]),
  can_send_message: z.boolean(),
  has_task: z.boolean(),
  task_status: z.enum(["pending", "running", "finished"]).nullable(),
  is_processing: z.boolean(),
  pending_confirmations: z.number().int().nonnegative(),
  turn_id: z.string().nullable(),
  supports_midturn_delivery: z.boolean().default(false),
});

export const aionConversationSchema = z.object({
  id: z.string().min(1), name: z.string(), type: z.string(),
  status: z.enum(["pending", "running", "finished"]),
  runtime: aionRuntimeSchema.optional(),
  created_at: z.number(), modified_at: z.number(),
  extra: z.record(z.string(), z.unknown()),
  assistant: z.object({ id: z.string(), name: z.string(), backend: z.string() }).optional(),
});

export const aionAssistantSchema = z.object({
  id: z.string().min(1), name: z.string(), enabled: z.boolean(), agent_id: z.string(),
  models: z.array(z.string()).default([]),
  agent_status: z.enum(["missing", "online", "offline", "unchecked"]),
  agent: z.object({ type: z.string(), source: z.string(), acp_backend: z.string().optional() }).optional(),
  /** AionCore `agent_metadata.yolo_id` — the full-auto permission for this harness. */
  yolo_id: z.string().optional(),
});

export const aionMessageSchema = z.object({
  id: z.string(), conversation_id: z.string(), msg_id: z.string().nullable(),
  type: z.string(), content: z.unknown(),
  position: z.enum(["right", "left", "center", "pop"]).nullable(),
  status: z.enum(["finish", "pending", "error", "work"]).nullable(),
  hidden: z.boolean(), created_at: z.number(), backend_turn_id: z.string().optional(),
});

export const aionMessagePageSchema = z.object({
  items: z.array(aionMessageSchema), oldest_cursor: z.string().nullable(), newest_cursor: z.string().nullable(),
  has_more_before: z.boolean(), has_more_after: z.boolean(),
});

export const aionAcceptedMessageSchema = z.object({
  msg_id: z.string().min(1), turn_id: z.string().min(1),
  delivered_midturn: z.boolean().default(false), runtime: aionRuntimeSchema,
});

export const aionConfirmationSchema = z.object({
  id: z.string().optional(),
  call_id: z.string().min(1),
  title: z.string().optional(),
  options: z.array(z.object({
    label: z.string(),
    value: z.string(),
    params: z.unknown().nullable().optional(),
  })).optional(),
}).passthrough();

export type AionConversation = z.infer<typeof aionConversationSchema>;
export type AionAssistant = z.infer<typeof aionAssistantSchema>;
export type AionRuntime = z.infer<typeof aionRuntimeSchema>;
export type AionConfirmation = z.infer<typeof aionConfirmationSchema>;

export interface AionConversationInput {
  assistantId: string;
  title: string;
  cwd: string;
  runId: string;
  model?: string;
  /**
   * Per-harness permission / YOLO mode id (e.g. bypassPermissions, agent-full-access, yolo).
   * Prefer the assistant's `yolo_id`. Cursor still also gets autoconfirmPermissions.
   */
  permission?: string;
  /** When true, reconciliation auto-confirms ACP permission prompts (Cursor/Copilot). */
  autoconfirmPermissions?: boolean;
  /** Enabled MCP server ids to attach to the new conversation. */
  mcpIds?: string[];
}

/** DevHub launches set per-harness permission + optional model / MCP attach. */
export function conversationPayload(input: AionConversationInput) {
  const overrides: Record<string, unknown> = {
    permission: input.permission?.trim() || "yolo",
  };
  if (input.model?.trim()) overrides.model = input.model.trim();
  const mcpIds = (input.mcpIds || []).map((id) => id.trim()).filter(Boolean);
  if (mcpIds.length) overrides.mcp_ids = mcpIds;
  return {
    name: input.title,
    assistant: {
      id: input.assistantId,
      conversation_overrides: overrides,
    },
    extra: {
      workspace: input.cwd,
      custom_workspace: true,
      ...(mcpIds.length ? { selected_mcp_server_ids: mcpIds } : {}),
      devhub: {
        run_id: input.runId,
        ...(input.autoconfirmPermissions ? { autoconfirm_permissions: true } : {}),
      },
    },
  };
}

/** Idle/finished is not proof of success; final outcome requires turn-specific evidence. */
export function activeRuntimeState(runtime: AionRuntime): "starting" | "running" | "needs-attention" | null {
  if (runtime.pending_confirmations > 0 || runtime.state === "waiting_confirmation") return "needs-attention";
  if (runtime.state === "starting" || runtime.state === "restarting") return "starting";
  if (runtime.is_processing || runtime.state === "running" || runtime.state === "cancelling") return "running";
  return null;
}

export function conversationWantsAutoconfirm(conversation: AionConversation): boolean {
  const extra = conversation.extra || {};
  const devhub = extra.devhub;
  if (devhub && typeof devhub === "object" && !Array.isArray(devhub)) {
    const flag = (devhub as Record<string, unknown>).autoconfirm_permissions;
    if (flag === true) return true;
    // Legacy DevHub-managed chats without the flag still get YOLO-style auto-confirm.
    if (typeof (devhub as Record<string, unknown>).run_id === "string") return true;
  }
  return false;
}
