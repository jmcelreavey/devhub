import { withPaseo } from "./client";
import { readPaseoManaged } from "./managed";

export interface PaseoUpdate {
  installed: string | null;
  latest: string | null;
  available: boolean;
  installable?: string;
  canUpdate?: boolean;
  ageStatus?: "eligible" | "too-new" | "unknown";
  checkedAt: number;
  error?: string;
}
const HOUR = 60 * 60 * 1000;
const MINIMUM_AGE = 24 * HOUR;
let cached: { latest: string | null; publishedAt?: unknown; checkedAt: number; error?: string } | undefined;
let pending: Promise<void> | undefined;
export function releaseEligibility(latest: string, publishedAt: unknown, now: number): { ageStatus: "eligible" | "too-new" | "unknown"; installable?: string } {
  const published = typeof publishedAt === "string" ? Date.parse(publishedAt) : NaN;
  if (!Number.isFinite(published) || published > now) return { ageStatus: "unknown" };
  if (now - published < MINIMUM_AGE) return { ageStatus: "too-new" };
  return { ageStatus: "eligible", installable: latest };
}
export function newerVersion(candidate: string, installed: string): boolean {
  if (!/^\d+\.\d+\.\d+$/.test(candidate)) return false;
  const a = candidate.split(".").map(Number);
  const b = installed.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (!Number.isFinite(b[i])) return false;
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/** Cache public registry metadata; a failed check must never look like "up to date". */
export async function checkPaseoUpdate(force = false): Promise<PaseoUpdate> {
  const installed = readPaseoManaged()?.version ?? null;
  if (!installed) return { installed, latest: null, available: false, checkedAt: Date.now() };
  const ttl = cached?.error ? 60_000 : HOUR;
  if (force || !cached || Date.now() - cached.checkedAt > ttl) {
    pending ??= (async () => {
      try {
        const response = await fetch("https://registry.npmjs.org/@getpaseo%2fcli", { signal: AbortSignal.timeout(8000), cache: "no-store" });
        if (!response.ok) throw new Error("Registry unavailable");
        const data = await response.json() as { "dist-tags"?: { latest?: unknown }; time?: Record<string, unknown> };
        const latest = data["dist-tags"]?.latest;
        if (typeof latest !== "string" || !/^\d+\.\d+\.\d+$/.test(latest)) throw new Error("Invalid release");
        cached = { latest, publishedAt: data.time?.[latest], checkedAt: Date.now() };
      } catch {
        cached = { latest: null, checkedAt: Date.now(), error: "Could not check for updates. Try again when online." };
      }
    })().finally(() => { pending = undefined; });
    await pending;
  }
  const { latest, publishedAt, checkedAt, error } = cached!;
  const { ageStatus, installable } = latest ? releaseEligibility(latest, publishedAt, Date.now()) : {};
  return { installed, latest, checkedAt, error, ageStatus, installable, available: latest ? newerVersion(latest, installed) : false, canUpdate: installable ? newerVersion(installable, installed) : false };
}

/** An update restarts the daemon. Check every page, including chats started directly in Paseo. */
export async function hasActivePaseoWork(): Promise<boolean> {
  return withPaseo(async ({ api }) => {
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const page = await api.agents.list({ scope: "active", page: { limit: 200, ...(cursor ? { cursor } : {}) } });
      if (page.entries.some(({ agent }) => agent.status === "running" || agent.status === "initializing" || agent.pendingPermissions.length > 0)) return true;
      if (!page.pageInfo.hasMore) return false;
      const next = page.pageInfo.nextCursor ?? undefined;
      if (!next || seen.has(next)) throw new Error("Could not verify that all chats are idle.");
      seen.add(next);
      cursor = next;
    } while (cursor);
    return false;
  });
}
