import { z } from "zod";
import { defineAction, type ActionDefinition } from "./define.ts";

interface PluginActionContext<Input> { run: (input: Input) => Promise<unknown> }
function pluginAction<Schema extends z.ZodObject>(
  input: Schema,
  name: string,
  description: string,
  discriminator: string,
): ActionDefinition<Schema, PluginActionContext<z.output<Schema>>, unknown> {
  return defineAction({
    input,
    http: { method: "POST", path: "/api/plugins/runtime/[name]", discriminator },
    mcp: { name, description, toolset: "plugins" },
    handler: (value, context) => context.run(value),
  });
}

const plugin = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/);
export const pluginActionListInput = z.object({ plugin, kind: z.enum(["actions", "runs"]) }).meta({ additionalProperties: false });
export const pluginActionReviewInput = z.object({ plugin, input: z.record(z.string().max(128), z.unknown()).refine((value) => new TextEncoder().encode(JSON.stringify(value)).length <= 32_768, "Action input is too large") }).meta({ additionalProperties: false });
export const pluginActionRunInput = z.object({ plugin, token: z.guid(), confirm: z.boolean().optional() }).meta({ additionalProperties: false });
export const pluginActionStatusInput = z.object({ plugin, runId: z.guid() }).meta({ additionalProperties: false });

export const pluginActionList = pluginAction(pluginActionListInput, "plugins_action_list", "List actions or recorded runs from an enabled, reviewed request-worker plugin. Only the declared /actions or /runs route is reachable; no source-route or command fallback.", "body kind=api, method=GET and path=/actions or /runs");
export const pluginActionReview = pluginAction(pluginActionReviewInput, "plugins_action_review", "Review an action through an enabled plugin\u0027s declared /actions/review route. The plugin validates its input and policy and returns the exact action, warning and expiring single-use token. Nothing executes here. Local plugin-management access is required.", "body kind=api, method=POST and path=/actions/review");
export const pluginActionRun = defineAction<typeof pluginActionRunInput, PluginActionContext<z.output<typeof pluginActionRunInput>> & { refuse: () => unknown }, unknown>({
  input: pluginActionRunInput,
  http: { method: "POST", path: "/api/plugins/runtime/[name]", discriminator: "body kind=api, method=POST and path=/actions/execute" },
  mcp: { name: "plugins_action_run", toolset: "plugins", description: "Execute one validated plugin action immediately with confirm:true. No human approval is required. Token expiry, single-use consumption and state rechecks belong to the plugin. Returns worker output after completion; an unknown outcome must be checked at the destination, never automatically retried." },
  handler: (value, context) => value.confirm === true ? context.run(value) : context.refuse(),
});
export const pluginActionStatus = pluginAction(pluginActionStatusInput, "plugins_action_status", "Read a recorded action outcome through an enabled plugin\u0027s declared /runs/status route. Never starts, cancels or retries a command.", "body kind=api, method=POST and path=/runs/status");
