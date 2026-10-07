import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { execExternal } from "@/lib/exec-external";
import type { ProviderUsage, UsageMeter, UsageSpend } from "./types";

// Undocumented: this is what Claude Code's own /usage screen calls. Parse
// defensively and expect it to change.
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

const credentialsSchema = z.object({
  claudeAiOauth: z.object({
    accessToken: z.string().min(1),
    expiresAt: z.number().optional(),
    subscriptionType: z.string().nullish(),
  }),
});

const windowSchema = z.object({ utilization: z.number(), resets_at: z.string().nullish() }).nullish();

const usageSchema = z.object({
  five_hour: windowSchema,
  seven_day: windowSchema,
  limits: z.array(z.object({ kind: z.string(), percent: z.number(), resets_at: z.string().nullish() })).nullish(),
  spend: z.object({
    used: z.object({ amount_minor: z.number(), currency: z.string(), exponent: z.number() }),
    limit: z.object({ amount_minor: z.number(), exponent: z.number() }).nullish(),
    enabled: z.boolean(),
  }).nullish(),
});

const LIMIT_LABELS: Record<string, string> = {
  session: "5-hour session",
  weekly_all: "Weekly, all models",
  weekly_opus: "Weekly, Opus",
  weekly_sonnet: "Weekly, Sonnet",
};

/**
 * Claude Code keeps its OAuth token in the macOS keychain, or in
 * ~/.claude/.credentials.json on Linux. We only read it — refreshing it here
 * would rotate the refresh token out from under Claude Code.
 */
async function readCredentials(): Promise<string | null> {
  if (process.platform === "darwin") {
    try {
      const { stdout } = await execExternal("security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"], { timeoutMs: 10_000, label: "usage:claude-keychain" });
      return stdout.trim();
    } catch {
      // Not in the keychain; fall through to the file Claude Code uses elsewhere.
    }
  }
  try {
    return await fs.readFile(path.join(os.homedir(), ".claude", ".credentials.json"), "utf8");
  } catch {
    return null;
  }
}

function titleCase(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function loadClaudeUsage(): Promise<ProviderUsage> {
  const base = { id: "claude", name: "Claude", meters: [], spend: [] } satisfies Partial<ProviderUsage>;
  const raw = await readCredentials();
  if (!raw) return { ...base, status: "unavailable", summary: "Sign in to Claude to see plan usage", command: "claude auth login", message: "To see plan usage, run `claude auth login` in DevHub's terminal (inside WSL on Windows)." };
  // JSON.parse errors quote the input, which here is a token — never let one surface.
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { parsed = null; }
  const creds = credentialsSchema.safeParse(parsed);
  if (!creds.success) return { ...base, status: "error", summary: "Couldn't read Claude's sign-in", message: "Claude Code's stored credentials are in an unexpected format.", reason: "~/.claude/.credentials.json is not in the format DevHub expects. Signing in again rewrites it." };
  const { accessToken, expiresAt, subscriptionType } = creds.data.claudeAiOauth;
  const plan = subscriptionType ? titleCase(subscriptionType) : undefined;
  if (expiresAt && expiresAt < Date.now()) return { ...base, plan, status: "unavailable", summary: "Claude's sign-in has expired", command: "claude auth login", message: "Claude Code's sign-in has expired. Run `claude auth login` in DevHub's terminal (inside WSL on Windows), then retry." };

  const response = await fetch(USAGE_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, "anthropic-beta": "oauth-2025-04-20" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Claude usage request failed (HTTP ${response.status}).`);
  const usage = usageSchema.parse(await response.json());

  const meters: UsageMeter[] = [];
  if (usage.limits?.length) {
    for (const limit of usage.limits) meters.push({ label: LIMIT_LABELS[limit.kind] ?? titleCase(limit.kind), percent: limit.percent, resetsAt: limit.resets_at ?? undefined });
  } else {
    // Older response shape, before `limits` existed.
    if (usage.five_hour) meters.push({ label: LIMIT_LABELS.session, percent: usage.five_hour.utilization, resetsAt: usage.five_hour.resets_at ?? undefined });
    if (usage.seven_day) meters.push({ label: LIMIT_LABELS.weekly_all, percent: usage.seven_day.utilization, resetsAt: usage.seven_day.resets_at ?? undefined });
  }

  const spend: UsageSpend[] = [];
  // Extra usage is a paid top-up; only worth a row when it's on or has been spent.
  if (usage.spend && (usage.spend.enabled || usage.spend.used.amount_minor > 0)) {
    const { used, limit } = usage.spend;
    spend.push({
      label: "Extra usage this month",
      amount: used.amount_minor / 10 ** used.exponent,
      currency: used.currency,
      limit: limit ? limit.amount_minor / 10 ** limit.exponent : undefined,
      source: "billed",
    });
  }
  return { ...base, plan, status: "ok", meters, spend };
}
