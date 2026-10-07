import type { AiProviderId } from "@/lib/ai/preference";
import type {
  ConventionRule,
  ConventionsFile,
  ConventionsPrefs,
  ConventionsSummary,
} from "@/lib/conventions/types";

/** A rule as the API sends it: with the server's verdict on whether it is in force. */
export interface RuleView extends ConventionRule {
  active: boolean;
}

export interface OverviewPayload {
  prefs: ConventionsPrefs;
  repos: ConventionsSummary[];
  /** Repos you could mine but haven't. */
  candidates: string[];
  /** Lower-cased repos with a run in flight. */
  mining: string[];
}

export interface DetailPayload {
  repo: string;
  prefs: ConventionsPrefs;
  mining: boolean;
  /** Absolute path of the rules file on disk. */
  storedAt: string;
  file: (Omit<ConventionsFile, "rules"> & { rules: RuleView[] }) | null;
  summary: ConventionsSummary | null;
}

export interface SettingsPayload {
  prefs: ConventionsPrefs;
  providers: { id: AiProviderId; label: string; available: boolean }[];
  /** What a blank provider resolves to right now. */
  resolved: AiProviderId | null;
  defaultModels: Record<AiProviderId, string>;
}

export type RuleAction =
  | { action: "status"; ruleId: string; status: "suggested" | "accepted" | "rejected" }
  | { action: "edit"; ruleId: string; text?: string; why?: string; scope?: string; category?: string }
  | { action: "delete"; ruleId: string };

export class ConventionsApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** POST to the conventions API; throws with the server's message so callers can toast it. */
export async function postConventions(body: Record<string, unknown>): Promise<{ started?: boolean; undoToken?: string }> {
  const res = await fetch("/api/conventions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => ({}))) as { error?: string; started?: boolean; undoToken?: string };
  if (!res.ok) throw new ConventionsApiError(payload.error ?? `Request failed (${res.status})`, res.status);
  return payload;
}

export function conventionsUrl(repo: string): string {
  return `/api/conventions?repo=${encodeURIComponent(repo)}`;
}

/** How often to re-read while a run is in flight; the page otherwise polls lazily. */
export const MINING_POLL_MS = 3_000;
export const IDLE_POLL_MS = 60_000;
