import type { z } from "zod";
import type { PluginContext } from "./context";
import type { LoadedRuntime } from "./runtime-catalog";
import { runtimeEnvironmentValues } from "./runtime-environment";

export function redactRuntimeSecrets(value: unknown, credentials: readonly string[]): unknown {
  const redactText = (text: string) => credentials.reduce((result, secret) => result.split(secret).join("[redacted]"), text);
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(child => redactRuntimeSecrets(child, credentials));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [redactText(key), redactRuntimeSecrets(child, credentials)]));
  return value;
}

/** Validate public worker data without leaking parser values or declared secrets. */
export function runtimeResponse<T>(schema: z.ZodType<T>, value: unknown, plugin: LoadedRuntime, ctx: PluginContext, secrets: "redact" | "reject" = "redact"): T {
  const invalid = () => new Error("The runtime provider returned an invalid response. Review its status in Plugins.");
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw invalid();
  const settings = runtimeEnvironmentValues(plugin.runtime, ctx.env);
  const credentials = plugin.runtime.permissions.env.flatMap((name) => [ctx.env[name], settings[name]].filter((value): value is string => !!value));
  const original = JSON.stringify(parsed.data);
  const redacted = JSON.stringify(redactRuntimeSecrets(parsed.data, credentials));
  if (secrets === "reject" && original !== redacted) throw invalid();
  const safe = schema.safeParse(JSON.parse(redacted));
  if (!safe.success) throw invalid();
  return safe.data;
}
