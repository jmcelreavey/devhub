import { z } from "zod";
import { findApiKey } from "./opencode-auth";
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
  const response = await fetch(QUOTA_URL, { headers: { Authorization: key, "Accept-Language": "en-US,en" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`z.ai usage failed (HTTP ${response.status}).`);
  const { level, limits } = quotaSchema.parse(await response.json()).data;
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
