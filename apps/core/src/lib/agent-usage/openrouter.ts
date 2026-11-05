import { z } from "zod";
import { UsageLoadError } from "./load-error";
import { findApiKey } from "./opencode-auth";
import type { ProviderUsage } from "./types";

const creditsSchema = z.object({
  data: z.object({
    total_credits: z.number().finite().nonnegative(),
    total_usage: z.number().finite().nonnegative(),
  }),
});

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
  let creditsResponse: Response;
  try {
    creditsResponse = await fetch("https://openrouter.ai/api/v1/credits", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new UsageLoadError("Couldn't load OpenRouter balance.", "Couldn't reach OpenRouter (network error or timeout).");
  }
  if (creditsResponse.status === 403) throw new UsageLoadError("Couldn't load OpenRouter balance.", "OpenRouter requires a management key to read credits.");
  if (!creditsResponse.ok) throw new UsageLoadError(`OpenRouter credits failed (HTTP ${creditsResponse.status}).`, `OpenRouter answered HTTP ${creditsResponse.status}.`);
  const credits = creditsSchema.safeParse(await creditsResponse.json().catch(() => null));
  if (!credits.success) throw new UsageLoadError("Couldn't read OpenRouter balance.", "OpenRouter returned credit data in an unexpected format.");
  const balance = { label: "Remaining credits", amount: credits.data.data.total_credits - credits.data.data.total_usage, currency: "USD" };
  if (balance.amount <= 0) return null;

  const response = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`OpenRouter key lookup failed (HTTP ${response.status}).`);
  const { usage, usage_monthly, limit } = keySchema.parse(await response.json()).data;
  return {
    id: "openrouter",
    name: "OpenRouter",
    status: "ok",
    balance,
    meters: limit ? [{ label: "Key spend limit", percent: (usage / limit) * 100 }] : [],
    spend: [
      ...(usage_monthly !== undefined ? [{ label: "This month", amount: usage_monthly, currency: "USD", source: "billed" as const }] : []),
      { label: "All time", amount: usage, currency: "USD", limit: limit ?? undefined, source: "billed" as const },
    ],
  };
}
