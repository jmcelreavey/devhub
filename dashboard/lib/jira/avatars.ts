import { apiBase, getResolvedJiraEnv, jsonHeaders } from "@/lib/jira/env";
import { isTrustedAvatarHost } from "@/lib/people/avatar-trust";
import { ttlCache } from "@/lib/ttl-cache";

/** email (lowercased) → Atlassian CDN avatar URL. */
export type AtlassianAvatarMap = Record<string, string>;

interface JiraAvatarUrls {
  "16x16"?: string;
  "24x24"?: string;
  "32x32"?: string;
  "48x48"?: string;
}

interface JiraUserHit {
  emailAddress?: string;
  avatarUrls?: JiraAvatarUrls;
}

/** Process-lifetime harvest — ticket assignees warm this for free. */
const harvest = new Map<string, string>();

const TTL_MS = 30 * 60_000;
/** Cap live user/search calls per resolve — identity load must stay snappy. */
const MAX_LIVE_SEARCHES = 30;
const SEARCH_CONCURRENCY = 5;

export function pickAtlassianAvatarUrl(avatarUrls?: JiraAvatarUrls | null): string | null {
  const url =
    avatarUrls?.["48x48"]?.trim() ||
    avatarUrls?.["32x32"]?.trim() ||
    avatarUrls?.["24x24"]?.trim() ||
    null;
  return url && trustedAtlassianAvatarUrl(url) ? url : null;
}

/** Only Atlassian avatar CDNs — same allowlist family as CommitAvatar. */
export function trustedAtlassianAvatarUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !isTrustedAvatarHost(parsed.hostname)) {
      return null;
    }
    // Reject GitHub hosts here — this helper is for Atlassian-sourced avatars.
    if (
      parsed.hostname === "avatars.githubusercontent.com" ||
      parsed.hostname === "github.com"
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Remember an email → Atlassian avatar when tickets (or other Jira payloads)
 * already returned one. The identity layer reads this before spending searches.
 */
export function rememberAtlassianAvatar(
  email: string | undefined | null,
  avatarUrl: string | undefined | null,
): void {
  const key = email?.trim().toLowerCase();
  const trusted = avatarUrl ? trustedAtlassianAvatarUrl(avatarUrl) : null;
  if (!key || !trusted) return;
  harvest.set(key, trusted);
}

function takeHarvest(emails: string[]): AtlassianAvatarMap {
  const out: AtlassianAvatarMap = {};
  for (const email of emails) {
    const hit = harvest.get(email);
    if (hit) out[email] = hit;
  }
  return out;
}

/**
 * One JQL page of recent assignees — fills the harvest with coworkers who show
 * up on tickets, which is usually enough for a company repo's active authors.
 */
const warmFromRecentAssignees = ttlCache(async (): Promise<void> => {
  const j = getResolvedJiraEnv();
  if (!j) return;

  const res = await fetch(`${apiBase(j)}/search/jql`, {
    method: "POST",
    headers: jsonHeaders(j),
    body: JSON.stringify({
      jql: "assignee is not EMPTY AND updated >= -180d ORDER BY updated DESC",
      fields: ["assignee"],
      maxResults: 100,
    }),
  });
  if (!res.ok) return;

  const data = (await res.json()) as {
    issues?: Array<{ fields?: { assignee?: JiraUserHit | null } }>;
  };
  for (const issue of data.issues ?? []) {
    const a = issue.fields?.assignee;
    rememberAtlassianAvatar(a?.emailAddress, pickAtlassianAvatarUrl(a?.avatarUrls) ?? undefined);
  }
}, TTL_MS);

async function searchAvatarByEmail(email: string): Promise<string | null> {
  const j = getResolvedJiraEnv();
  if (!j) return null;

  const res = await fetch(
    `${apiBase(j)}/user/search?query=${encodeURIComponent(email)}&maxResults=5`,
    { headers: jsonHeaders(j) },
  );
  if (!res.ok) return null;

  const users = (await res.json()) as JiraUserHit[];
  if (!Array.isArray(users) || users.length === 0) return null;

  const exact = users.find((u) => u.emailAddress?.trim().toLowerCase() === email);
  // Orgs often hide emailAddress; a single hit for an email query is still usable.
  const candidate = exact ?? (users.length === 1 ? users[0] : undefined);
  const url = pickAtlassianAvatarUrl(candidate?.avatarUrls);
  if (url) rememberAtlassianAvatar(email, url);
  return url;
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

/**
 * Resolve Atlassian avatars for the given emails.
 *
 * Order: process harvest (ticket assignees) → recent-assignee warm → live
 * `user/search` for remaining (capped). Missing Jira config yields harvest hits
 * only; never throws — avatars are decoration.
 */
export async function resolveAtlassianAvatars(emails: string[]): Promise<AtlassianAvatarMap> {
  const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (wanted.length === 0) return {};

  const out = takeHarvest(wanted);
  const stillMissing = () => wanted.filter((e) => !out[e]);

  if (!getResolvedJiraEnv()) return out;

  try {
    await warmFromRecentAssignees();
  } catch {
    // Warm is best-effort; live search below may still answer.
  }
  Object.assign(out, takeHarvest(stillMissing()));

  const missing = stillMissing().slice(0, MAX_LIVE_SEARCHES);
  if (missing.length === 0) return out;

  try {
    await mapPool(missing, SEARCH_CONCURRENCY, async (email) => {
      const url = await searchAvatarByEmail(email);
      if (url) out[email] = url;
    });
  } catch {
    // Partial map is fine.
  }

  return out;
}
