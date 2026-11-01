import { z } from "zod";
import { defineAction, type ActionDefinition } from "./define.ts";

interface PluginHostContext<Input> { execute: (input: Input) => unknown }

function pluginHostAction<Schema extends z.ZodObject>(
  input: Schema,
  method: "GET" | "POST",
  path: string,
  reason: string,
): ActionDefinition<Schema, PluginHostContext<z.output<Schema>>, unknown> {
  return defineAction({
    input,
    http: { method, path },
    mcp: { reason },
    handler: (value, context) => context.execute(value),
  });
}

export const pluginRegistrationsInput = z.object({});
export const pluginRegistrations = pluginHostAction(pluginRegistrationsInput, "GET", "/api/plugins", "The browser's local plugin management screen displays registrations and unfinished host operations.");

export const pluginRegistrationInput = z.object({ id: z.string() });
export const pluginRegistration = pluginHostAction(pluginRegistrationInput, "GET", "/api/plugins/[id]", "The browser's local plugin management screen inspects one registration.");

export const pluginEnablePreviewInput = z.object({ id: z.string() });
export const pluginEnablePreview = pluginHostAction(pluginEnablePreviewInput, "POST", "/api/plugins/[id]/enable-preview", "Starting an enable operation belongs to the browser's reviewed plugin management workflow.");

export const pluginDisablePreviewInput = z.object({ id: z.string() });
export const pluginDisablePreview = pluginHostAction(pluginDisablePreviewInput, "POST", "/api/plugins/[id]/disable-preview", "Starting a disable operation belongs to the browser's reviewed plugin management workflow.");

export const pluginRemovePreviewInput = z.object({ id: z.string() });
export const pluginRemovePreview = pluginHostAction(pluginRemovePreviewInput, "POST", "/api/plugins/[id]/remove-preview", "Starting a removal operation belongs to the browser's reviewed plugin management workflow.");

export const pluginOperationInput = z.object({ id: z.string() });
export const pluginOperation = pluginHostAction(pluginOperationInput, "GET", "/api/plugins/operations/[id]", "The browser polls the state of a local plugin management operation.");

export const pluginOperationCancelInput = z.object({ id: z.string() });
export const pluginOperationCancel = pluginHostAction(pluginOperationCancelInput, "POST", "/api/plugins/operations/[id]/cancel", "Cancelling a host operation is part of the browser's plugin management workflow.");

export const pluginOperationDiagnosticsInput = z.object({ id: z.string() });
export const pluginOperationDiagnostics = pluginHostAction(pluginOperationDiagnosticsInput, "GET", "/api/plugins/operations/[id]/diagnostics", "Operation diagnostics are generated for the local plugin management screen.");

export const pluginOperationPreviewInput = z.object({ id: z.string() });
export const pluginOperationPreview = pluginHostAction(pluginOperationPreviewInput, "GET", "/api/plugins/operations/[id]/preview", "The browser reviews a host operation's proposed changes before confirmation.");

export const pluginOperationRecheckInput = z.object({ id: z.string() });
export const pluginOperationRecheck = pluginHostAction(pluginOperationRecheckInput, "POST", "/api/plugins/operations/[id]/recheck", "Rechecking a reviewed plugin operation is controlled by the browser's management workflow.");

export const pluginOperationRetryCleanupInput = z.object({ id: z.string() });
export const pluginOperationRetryCleanup = pluginHostAction(pluginOperationRetryCleanupInput, "POST", "/api/plugins/operations/[id]/retry-cleanup", "Retrying host cleanup is an explicit plugin management operation in the browser.");

export const pluginOperationConfirmInput = z.object({
  id: z.string(), revision: z.custom<number>((value) => typeof value === "number"), planDigest: z.string(), selectedTargets: z.array(z.string()),
  accepted: z.boolean(), idempotencyKey: z.string().nullable(),
});
export const pluginOperationConfirm = pluginHostAction(pluginOperationConfirmInput, "POST", "/api/plugins/operations/[id]/confirm", "The browser confirms the reviewed host plan, including target selection and idempotency.");

export const pluginPrepareInput = z.object({ url: z.string(), idempotencyKey: z.string().nullable() });
export const pluginPrepare = pluginHostAction(pluginPrepareInput, "POST", "/api/plugins/prepare", "Preparing a plugin installation starts the browser's host review and confirmation flow.");

export const pluginRuntimeBrandingInput = z.object({});
export const pluginRuntimeBranding = pluginHostAction(pluginRuntimeBrandingInput, "GET", "/api/plugins/runtime-branding", "The browser loads local plugin branding assets for the dashboard shell.");

export const pluginSlotsInput = z.object({ location: z.enum(["repo", "task", "setup"]) });
export const pluginSlots = pluginHostAction(pluginSlotsInput, "GET", "/api/plugins/slots", "The browser discovers runtime slots for a specific dashboard location.");

export const pluginSlotInvokeInput = z.object({ body: z.unknown() });
export const pluginSlotInvoke = pluginHostAction(pluginSlotInvokeInput, "POST", "/api/plugins/slots", "Slot invocation is a browser runtime request whose payload is validated by the host and plugin.");

export const pluginThemesInput = z.object({});
export const pluginThemes = pluginHostAction(pluginThemesInput, "GET", "/api/plugins/themes", "The browser loads the current plugin theme catalogue for dashboard rendering.");

export const pluginThemeAssetInput = z.object({ name: z.string(), preset: z.string(), revision: z.string(), asset: z.string() });
export const pluginThemeAsset = pluginHostAction(pluginThemeAssetInput, "GET", "/api/plugins/themes/[name]/[preset]", "Theme assets are served as browser bytes or safe HTML data, including range requests.");

export const pluginNavigationInput = z.object({});
export const pluginNavigation = pluginHostAction(pluginNavigationInput, "GET", "/api/plugins/navigation", "The dashboard shell reads reviewed plugin navigation entries for browser rendering.");

export const pluginBrowserActionInput = z.object({ name: z.string(), body: z.unknown(), create: z.string().nullable() });
export const pluginBrowserAction = pluginHostAction(pluginBrowserActionInput, "POST", "/api/plugins/runtime/[name]/browser", "Browser page actions use host authorization and an explicit confirmation before creating notes.");

export const pluginRuntimeMcpInput = z.object({ name: z.string(), server: z.string(), body: z.unknown() });
export const pluginRuntimeMcp = pluginHostAction(pluginRuntimeMcpInput, "POST", "/api/plugins/runtime/[name]/mcp/[server]", "This is an authenticated JSON-RPC transport to a plugin-owned MCP server, not a DevHub MCP tool.");

export const pluginRuntimeReadInput = z.object({ name: z.string(), view: z.string().nullable() });
export const pluginRuntimeRead = pluginHostAction(pluginRuntimeReadInput, "GET", "/api/plugins/runtime/[name]", "The authenticated browser loads reviewed runtime metadata.");

export const pluginLocalRuntimeInput = z.object({ body: z.unknown() });
export const pluginLocalRuntime = pluginHostAction(pluginLocalRuntimeInput, "POST", "/api/plugins/local-runtime", "Local plugin review requires a same-origin browser and cannot be approved through MCP.");

export const pluginServiceReviewInput = z.object({ id: z.string().min(1) });
export const pluginServiceReview = pluginHostAction(pluginServiceReviewInput, "GET", "/api/plugins/[id]/service", "The browser reviews a plugin's separately approved background service.");

export const pluginServiceChangeInput = z.object({
  id: z.string().min(1),
  body: z.discriminatedUnion("action", [
    z.object({ action: z.literal("approve"), digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
    z.object({ action: z.literal("disable") }).strict(),
  ]),
});
export const pluginServiceChange = pluginHostAction(pluginServiceChangeInput, "POST", "/api/plugins/[id]/service", "Service approval requires an explicit same-origin browser review and cannot be granted through MCP.");
