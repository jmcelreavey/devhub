import { z } from "zod";
import { execExternal } from "@/lib/exec-external";
import type { ProviderUsage, UsageMeter } from "./types";

// Undocumented: what VS Code's Copilot status menu calls. Auth is the `gh` token.
const quotaSchema = z.object({
  entitlement: z.number(),
  percent_remaining: z.number(),
  unlimited: z.boolean().optional(),
});

const userSchema = z.object({
  copilot_plan: z.string().optional(),
  quota_reset_date_utc: z.string().optional(),
  quota_snapshots: z.record(z.string(), quotaSchema.partial().passthrough()).optional(),
});

const QUOTA_LABELS: Record<string, string> = {
  premium_interactions: "Premium requests",
  chat: "Chat",
  completions: "Completions",
};

async function ghToken(): Promise<string | null> {
  try {
    const { stdout } = await execExternal("gh", ["auth", "token"], { timeoutMs: 10_000, label: "usage:copilot-gh-token" });
    return stdout.trim() || null;
  } catch {
    // gh missing or signed out: Copilot isn't set up here.
    return null;
  }
}

export async function loadCopilotUsage(): Promise<ProviderUsage | null> {
  const token = await ghToken();
  if (!token) return null;
  const response = await fetch("https://api.github.com/copilot_internal/user", {
    headers: { Authorization: `token ${token}`, "Editor-Version": "vscode/1.99.0" },
    signal: AbortSignal.timeout(15_000),
  });
  // 404 means this GitHub account has no Copilot subscription.
  if (response.status === 404 || response.status === 403) return null;
  if (!response.ok) throw new Error(`Copilot usage failed (HTTP ${response.status}).`);
  const user = userSchema.parse(await response.json());
  const resetsAt = user.quota_reset_date_utc;
  const meters: UsageMeter[] = [];
  for (const [id, quota] of Object.entries(user.quota_snapshots ?? {})) {
    // Unlimited and zero-entitlement quotas have no allowance to measure.
    if (quota.unlimited || !quota.entitlement || quota.percent_remaining === undefined) continue;
    meters.push({ label: QUOTA_LABELS[id] ?? id, percent: 100 - quota.percent_remaining, resetsAt });
  }
  return { id: "copilot", name: "GitHub Copilot", plan: user.copilot_plan, status: "ok", meters, spend: [] };
}
