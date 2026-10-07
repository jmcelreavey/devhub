import { z } from "zod";
import { findApiKey } from "./opencode-auth";
import { UsageLoadError } from "./load-error";
import type { ProviderUsage } from "./types";

// Undocumented: the endpoint z.ai's own usage page (and community GLM plan
// plugins) call for the GLM Coding Plan. Parse defensively and expect it to move.
const QUOTA_URL = "https://api.z.ai/api/monitor/usage/quota/limit";

const quotaSchema = z.object({
  data: z.object({
    level: z.string().optional(),
    limits: z.array(z.object({ type: z.string(), percentage: z.number(), nextResetTime: z.number().optional() })),
  }),
});

const LIMIT_LABELS: Record<string, string> = {
  TOKENS_LIMIT: "5-hour prompts",
  TIME_LIMIT: "Monthly tool calls",
};

export async function loadZaiUsage(): Promise<ProviderUsage | null> {
  const key = await findApiKey("ZAI_API_KEY", ["zai-coding-plan", "zai", "zhipuai-coding-plan"]);
  if (!key) return null;
  let response: Response;
  try {
    response = await fetch(QUOTA_URL, { headers: { Authorization: key, "Accept-Language": "en-US,en" }, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new UsageLoadError("Couldn't load z.ai usage: the request failed.", "Couldn't reach z.ai (network error or timeout).");
  }
  if (response.status === 401 || response.status === 403) {
    throw new UsageLoadError(`z.ai usage failed (HTTP ${response.status}).`, `z.ai rejected the API key (HTTP ${response.status}). Check ZAI_API_KEY or the key saved in OpenCode.`);
  }
  if (!response.ok) throw new UsageLoadError(`z.ai usage failed (HTTP ${response.status}).`, `z.ai's usage endpoint answered HTTP ${response.status}.`);
  const parsed = quotaSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new UsageLoadError("Couldn't load z.ai usage: the service returned no usable quota data.", "z.ai returned data in an unexpected shape. The usage endpoint is undocumented and may have changed.");
  const { level, limits } = parsed.data.data;
  return {
    id: "zai",
    name: "z.ai",
    plan: level,
    status: "ok",
    meters: limits.map((limit) => ({
      label: LIMIT_LABELS[limit.type] ?? limit.type,
      percent: limit.percentage,
      resetsAt: limit.nextResetTime ? new Date(limit.nextResetTime).toISOString() : undefined,
    })),
    spend: [],
  };
}
