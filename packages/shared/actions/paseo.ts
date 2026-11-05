import { z } from "zod";
import { defineAction } from "./define.ts";

export const PASEO_CLI_LABELS = ["Claude", "Cursor", "OpenCode", "Copilot", "Codex", "Gemini"] as const;

interface PaseoLocalContext {
  execute: (input: z.output<z.ZodObject>) => unknown;
}

function localPaseoAction(input: z.ZodObject, method: "GET" | "POST", path: string, reason: string, discriminator?: string) {
  return defineAction<z.ZodObject, PaseoLocalContext, unknown>({
    input,
    http: { method, path, discriminator },
    mcp: { reason },
    handler: (value, context) => context.execute(value),
  });
}

export const paseoManagedStatusInput = z.object({});
export const paseoManagedStatus = localPaseoAction(paseoManagedStatusInput, "GET", "/api/paseo/managed", "Paseo connection setup is a local dashboard surface.");

export const paseoManagedRepairInput = z.object({ action: z.literal("repair-opencode-mcp") });
export const paseoManagedSetupInput = z.object({ action: z.literal("setup") });
export const paseoManagedUpdateInput = z.object({ action: z.literal("update"), version: z.string().regex(/^\d+\.\d+\.\d+$/).max(32) });
export const paseoManagedCheckUpdateInput = z.object({ action: z.literal("check-update") });
export const paseoManagedRestartInput = z.object({ action: z.literal("restart") });
export const paseoManagedPairInput = z.object({ action: z.literal("pair") });
export const paseoManagedUnpairInput = z.object({ action: z.literal("unpair") });
export const paseoManagedProviderInput = z.object({ action: z.literal("default-provider"), provider: z.string().regex(/^[a-z][a-z0-9-]*$/).max(64) });

export const paseoManagedInput = z.discriminatedUnion("action", [
  paseoManagedRepairInput, paseoManagedSetupInput, paseoManagedUpdateInput, paseoManagedCheckUpdateInput,
  paseoManagedRestartInput, paseoManagedPairInput, paseoManagedUnpairInput, paseoManagedProviderInput,
]);

const managedReason = "Paseo installation, pairing and service control require the local dashboard.";
export const paseoManagedRepair = localPaseoAction(paseoManagedRepairInput, "POST", "/api/paseo/managed", managedReason, "body action=repair-opencode-mcp");
export const paseoManagedSetup = localPaseoAction(paseoManagedSetupInput, "POST", "/api/paseo/managed", managedReason, "body action=setup");
export const paseoManagedUpdate = localPaseoAction(paseoManagedUpdateInput, "POST", "/api/paseo/managed", managedReason, "body action=update");
export const paseoManagedCheckUpdate = localPaseoAction(paseoManagedCheckUpdateInput, "POST", "/api/paseo/managed", managedReason, "body action=check-update");
export const paseoManagedRestart = localPaseoAction(paseoManagedRestartInput, "POST", "/api/paseo/managed", managedReason, "body action=restart");
export const paseoManagedPair = localPaseoAction(paseoManagedPairInput, "POST", "/api/paseo/managed", managedReason, "body action=pair");
export const paseoManagedUnpair = localPaseoAction(paseoManagedUnpairInput, "POST", "/api/paseo/managed", managedReason, "body action=unpair");
export const paseoManagedProvider = localPaseoAction(paseoManagedProviderInput, "POST", "/api/paseo/managed", managedReason, "body action=default-provider");
export const paseoManagedActions = {
  "repair-opencode-mcp": paseoManagedRepair,
  setup: paseoManagedSetup,
  update: paseoManagedUpdate,
  "check-update": paseoManagedCheckUpdate,
  restart: paseoManagedRestart,
  pair: paseoManagedPair,
  unpair: paseoManagedUnpair,
  "default-provider": paseoManagedProvider,
};

export const paseoOpenInput = z.object({ run: z.string().nullable(), agent: z.string().nullable(), format: z.string().nullable() });
export const paseoOpen = localPaseoAction(paseoOpenInput, "GET", "/api/paseo/open", "Opening a chat redirects the dashboard's local browser frame.");

export const paseoCliUpdatesInput = z.object({ external: z.boolean() });
export interface PaseoCliUpdatesContext {
  read: (external: boolean) => unknown;
}
export const paseoCliUpdates = defineAction<typeof paseoCliUpdatesInput, PaseoCliUpdatesContext, unknown>({
  input: paseoCliUpdatesInput,
  http: { method: "GET", path: "/api/paseo/cli-updates" },
  mcp: { reason: "Installed CLI update state belongs to local dashboard setup." },
  handler: ({ external }, context) => context.read(external),
});

export const paseoCliPreferencesInput = z.object({
  enabled: z.boolean().optional(),
  agent: z.enum(PASEO_CLI_LABELS).optional(),
  pinned: z.boolean().optional(),
  skip: z.boolean().optional(),
}).strict().refine((value) => value.enabled !== undefined || (value.agent && (value.pinned !== undefined || value.skip !== undefined)));
export interface PaseoCliPreferencesContext {
  save: (input: z.output<typeof paseoCliPreferencesInput>) => unknown;
}
export const paseoCliPreferences = defineAction<typeof paseoCliPreferencesInput, PaseoCliPreferencesContext, unknown>({
  input: paseoCliPreferencesInput,
  http: { method: "PATCH", path: "/api/paseo/cli-updates" },
  mcp: { reason: "Local CLI update preferences are configured from the dashboard." },
  handler: (input, context) => context.save(input),
});

export const paseoTaskContextInput = z.object({
  query: z.string().max(300).optional(),
  agentId: z.string().max(128).optional(),
  taskId: z.string().max(128).optional(),
});
export interface PaseoTaskContextContext {
  read: (input: z.output<typeof paseoTaskContextInput>) => unknown;
}
export const paseoTaskContext = defineAction<typeof paseoTaskContextInput, PaseoTaskContextContext, unknown>({
  input: paseoTaskContextInput,
  http: { method: "GET", path: "/api/paseo/task-context" },
  mcp: { reason: "This dashboard view builds task context for the local Paseo interface." },
  handler: (input, context) => context.read(input),
});

export const paseoUpdateInput = z.object({});
export interface PaseoUpdateContext {
  check: () => Promise<unknown>;
}
export const paseoUpdate = defineAction<typeof paseoUpdateInput, PaseoUpdateContext, unknown>({
  input: paseoUpdateInput,
  http: { method: "GET", path: "/api/paseo/update" },
  mcp: { reason: "Paseo update checks are a local setup surface." },
  handler: (_input, context) => context.check(),
});
