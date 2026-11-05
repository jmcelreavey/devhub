import { z } from "zod";
import { UsageLoadError } from "./load-error";
import { findActiveOpenCodeKey, findApiKey } from "./opencode-auth";
import type { ProviderUsage } from "./types";

// OpenCode's Go usage API reports plan allowance used, not API spend.
const USAGE_URL = "https://opencode.ai/inference/go/v1/usage";
const windowSchema = z.object({
  percent: z.number().finite().nonnegative(),
  resetsAt: z.string().datetime(),
});
const usageSchema = z.object({
  usage: z.object({ rolling: windowSchema, weekly: windowSchema, monthly: windowSchema }),
});

export async function loadOpenCodeGoUsage(): Promise<ProviderUsage | null> {
  const key = process.env.OPENCODE_GO_API_KEY?.trim()
    || process.env.OPENCODE_API_KEY?.trim()
    || findActiveOpenCodeKey(["opencode-go", "opencode"])
    || await findApiKey("OPENCODE_API_KEY", ["opencode-go", "opencode_go", "opencode"]);
  if (!key) return null;

  let response: Response;
  try {
    response = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new UsageLoadError("Couldn't load OpenCode Go usage.", "Couldn't reach OpenCode (network error or timeout).");
  }
  if (response.status === 401) {
    throw new UsageLoadError("OpenCode Go rejected the saved key.", "Reconnect OpenCode Console or Go in OpenCode, then retry.");
  }
  if (response.status === 403) {
    throw new UsageLoadError("OpenCode Go usage isn't available for this key.", "Check that the signed-in workspace has an active Go subscription.");
  }
  if (!response.ok) throw new UsageLoadError(`OpenCode Go usage failed (HTTP ${response.status}).`, `OpenCode answered HTTP ${response.status}.`);

  const parsed = usageSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new UsageLoadError("Couldn't read OpenCode Go usage.", "OpenCode returned usage data in an unexpected format.");

  const { rolling, weekly, monthly } = parsed.data.usage;
  return {
    id: "opencode-go",
    name: "OpenCode Go",
    status: "ok",
    meters: [
      { label: "5-hour", percent: rolling.percent, resetsAt: rolling.resetsAt },
      { label: "Weekly", percent: weekly.percent, resetsAt: weekly.resetsAt },
      { label: "Monthly", percent: monthly.percent, resetsAt: monthly.resetsAt },
    ],
    spend: [],
  };
}
