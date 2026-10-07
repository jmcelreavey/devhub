import { z } from "zod";
import { findApiKey } from "./opencode-auth";
import type { ProviderUsage } from "./types";

// Documented: https://openrouter.ai/docs/api-reference/limits
const keySchema = z.object({
  data: z.object({
    usage: z.number(),
    usage_monthly: z.number().optional(),
    limit: z.number().nullish(),
    limit_reset: z.string().nullish(),
  }),
});

export async function loadOpenRouterUsage(): Promise<ProviderUsage | null> {
  const key = await findApiKey("OPENROUTER_API_KEY", ["openrouter"]);
  if (!key) return null;
  const response = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`OpenRouter key lookup failed (HTTP ${response.status}).`);
  const { usage, usage_monthly, limit } = keySchema.parse(await response.json()).data;
  return {
    id: "openrouter",
    name: "OpenRouter",
    status: "ok",
    meters: limit ? [{ label: "Key spend limit", percent: (usage / limit) * 100 }] : [],
    spend: [
      ...(usage_monthly !== undefined ? [{ label: "This month", amount: usage_monthly, currency: "USD", source: "billed" as const }] : []),
      { label: "All time", amount: usage, currency: "USD", limit: limit ?? undefined, source: "billed" as const },
    ],
  };
}
