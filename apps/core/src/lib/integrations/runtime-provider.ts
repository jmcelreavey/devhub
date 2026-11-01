import { createHash } from "node:crypto";
import { z } from "zod";
import { pluginContext, type PluginContext } from "../plugins/context";
import { invokeRuntime, loadRuntime, runtimeCatalog, type LoadedRuntime } from "../plugins/runtime-host";
import { runtimeResponse } from "../plugins/runtime-response";
import { assertCapability, IntegrationError, RefSchema, refKey, type IntegrationProvider } from "./types";
import { WriteInputSchema, type PreparedWrite, type WriteInput } from "./write-types";

const text = z.string().min(1).max(2000);
const url = z.url().max(4000).refine((value) => {
  const parsed = new URL(value);
  return ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
});
const accountSchema = z.object({ provider: RefSchema.shape.provider, id: RefSchema.shape.account, label: text }).strict();
const accountsSchema = z.array(accountSchema).max(50);
const itemSchema = z.object({
  ref: RefSchema, title: text, url: url.optional(), revision: text.optional(), draft: z.boolean().optional(),
  status: z.object({ id: text, label: text, category: text.optional() }).strict().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();
const setupSchema = z.object({ configured: z.boolean(), fields: z.record(z.string().max(80), z.union([z.boolean(), z.string().max(2000)])) }).strict();
const alertSchema = z.object({ id: text, title: text, timestampMs: z.number().finite().nonnegative(), status: text.optional(), url }).strict();
const alertsSchema = z.object({ oncall: z.array(alertSchema).max(100), related: z.array(alertSchema).max(100) }).strict();
const transitionsSchema = z.array(z.object({ id: text, label: text, statusId: text.optional(), statusLabel: text.optional() }).strict()).max(100);
const preparedSchema = z.object({ destination: text, actor: text, summary: text, details: z.record(z.string(), z.unknown()), native: z.record(z.string(), z.unknown()) }).strict();
const receiptSchema = z.object({ item: itemSchema.optional(), detail: text }).strict();
const errorSchema = z.object({ error: z.object({ kind: z.enum(["auth", "rate-limit", "not-found", "unsupported", "conflict", "unavailable", "invalid"]), retryAfter: z.number().int().min(1).max(3600).optional() }).strict() }).strict();
const errorMessages = {
  auth: "The runtime provider rejected this account's credentials or permissions.",
  "rate-limit": "The runtime provider rate limit was reached.",
  "not-found": "The item or account was not found in this provider.",
  unsupported: "This runtime provider does not support the requested action.",
  conflict: "The provider item changed. Prepare the action again before trying to execute it.",
  unavailable: "The runtime integration provider is unavailable. Check its status before retrying an action.",
  invalid: "The runtime integration provider returned an invalid response.",
};
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

export function runtimeIntegrationProviders(ctx: PluginContext = pluginContext()): IntegrationProvider[] {
  return runtimeCatalog(ctx).flatMap((plugin) => (plugin.runtime.capabilities?.integrations ?? []).map((spec): IntegrationProvider => {
    const preparedWrites = new WeakMap<PreparedWrite, { input: string; prepared: string; at: number }>();
    const current = () => {
      let loaded: LoadedRuntime;
      try { loaded = loadRuntime(ctx, plugin.name); }
      catch { throw new IntegrationError("unsupported", "This provider is absent or disabled."); }
      if (loaded.root !== plugin.root || loaded.runtime.sha256 !== plugin.runtime.sha256) throw new IntegrationError("conflict", "The runtime provider changed. Prepare the action again.");
    };
    const call = async (operation: string, body: Record<string, unknown> = {}, signal?: AbortSignal): Promise<unknown> => {
      current();
      try {
        const output = await invokeRuntime(ctx, plugin.name, { kind: "integration", path: operation, method: "POST", body: { ...body, provider: spec.id } }, signal);
        try { current(); }
        catch (error) {
          if (operation === "executeWrite") throw new IntegrationError("unavailable", errorMessages.unavailable);
          throw error;
        }
        const failure = errorSchema.safeParse(output);
        if (failure.success) throw new IntegrationError(failure.data.error.kind, errorMessages[failure.data.error.kind], failure.data.error.retryAfter);
        return output;
      } catch (error) {
        if (error instanceof IntegrationError) throw error;
        throw new IntegrationError("unavailable", errorMessages.unavailable);
      }
    };
    const parse = <T>(schema: z.ZodType<T>, value: unknown, secrets: "redact" | "reject" = "redact"): T => {
      try { return runtimeResponse(schema, value, plugin, ctx, secrets); }
      catch { throw new IntegrationError("invalid", errorMessages.invalid); }
    };
    const accounts = async () => {
      const values = parse(accountsSchema, await call("accounts"));
      if (values.some((account) => account.provider !== spec.id) || new Set(values.map((account) => account.id)).size !== values.length) throw new IntegrationError("invalid", errorMessages.invalid);
      return values;
    };
    const account = async (id: string) => {
      if (!(await accounts()).some((account) => account.id === id)) throw new IntegrationError("not-found", "This account is no longer configured.");
    };
    const inputForWrite = async (raw: WriteInput) => {
      const parsed = WriteInputSchema.safeParse(raw);
      if (!parsed.success || parsed.data.provider !== spec.id) throw new IntegrationError("invalid", "The action must belong to this provider.");
      assertCapability(provider, parsed.data.action);
      await account(parsed.data.account);
      return parsed.data;
    };
    const provider: IntegrationProvider = {
      id: spec.id, pluginName: plugin.name, apiVersion: 1, label: spec.label, capabilities: spec.capabilities, accounts,
      async setupStatus() { return parse(setupSchema, await call("setupStatus")); },
      async get(raw, context) {
        const ref = parse(RefSchema, raw, "reject");
        if (ref.provider !== spec.id) throw new IntegrationError("invalid", "The item must belong to this provider.");
        assertCapability(provider, `${ref.kind}.read`);
        await account(ref.account);
        const item = parse(itemSchema, await call("get", { ref }, context.signal));
        if (refKey(item.ref) !== refKey(ref)) throw new IntegrationError("invalid", errorMessages.invalid);
        return item;
      },
      async transitions(raw, context) {
        const ref = parse(RefSchema, raw, "reject");
        if (ref.provider !== spec.id || ref.kind !== "issue") throw new IntegrationError("invalid", "Choose an issue in this provider.");
        assertCapability(provider, "issue.transitions");
        await account(ref.account);
        return parse(transitionsSchema, await call("transitions", { ref }, context.signal));
      },
      async prepareWrite(raw, context) {
        const input = await inputForWrite(raw);
        const prepared = parse(preparedSchema, await call("prepareWrite", { input }, context.signal), "reject");
        preparedWrites.set(prepared, { input: digest(input), prepared: digest(prepared), at: Date.now() });
        return prepared;
      },
      async executeWrite(raw, prepared, context) {
        const input = await inputForWrite(raw);
        const binding = preparedWrites.get(prepared);
        if (!context.requestId || !binding || binding.input !== digest(input) || binding.prepared !== digest(prepared) || Date.now() - binding.at > 60_000) throw new IntegrationError("conflict", "The preparation is stale or changed. Prepare the action again.");
        // Consume before sending: a timeout is an unknown outcome, never an automatic retry.
        preparedWrites.delete(prepared);
        const output = await call("executeWrite", { input, prepared, requestId: context.requestId }, context.signal);
        let receipt: z.infer<typeof receiptSchema>;
        try { receipt = parse(receiptSchema, output, "reject"); }
        catch { throw new IntegrationError("unavailable", errorMessages.unavailable); }
        if (receipt.item && (receipt.item.ref.provider !== spec.id || receipt.item.ref.account !== input.account || receipt.item.ref.kind !== (input.action.startsWith("issue.") ? "issue" : "pr") || ("ref" in input && refKey(receipt.item.ref) !== refKey(input.ref)))) throw new IntegrationError("unavailable", errorMessages.unavailable);
        return receipt;
      },
    };
    if (spec.capabilities.includes("alerts.read")) provider.alerts = { async recent(limit) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new IntegrationError("invalid", "Use an alert limit between 1 and 100.");
      return parse(alertsSchema, await call("alerts", { limit }));
    } };
    return provider;
  }));
}
