import { todayISO } from "@shared/tasks/dates.ts";

/** The local calendar day. One implementation, shared with the task store and the MCP server. */
export { todayISO };

export function yesterdayISO(now = new Date()): string {
  const previous = new Date(now);
  previous.setDate(previous.getDate() - 1);
  return todayISO(previous);
}

/** Vault slug for a daily note (`daily/YYYY-MM-DD`). */
export function dailyNotePath(date?: string): string {
  return `daily/${date ?? todayISO()}`;
}

/** Long-form label for a calendar date, e.g. "Sunday, June 7". */
export function formatDayLabel(dateIso: string): string {
  const [year, month, day] = dateIso.split("-").map(Number);
  return new Date(year!, month! - 1, day!).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export const JIRA_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/;

export function jiraKeyFromText(text: string): string | null {
  return text.match(JIRA_KEY_RE)?.[1] ?? null;
}

/**
 * Public-seed placeholder. Never a real site — browse links must not fall
 * back to it when the installed app was built without a public Jira domain.
 */
export const JIRA_DOMAIN_PLACEHOLDER = "your-domain.atlassian.net";

/** Hostname only. Empty when missing, unsafe, or the public-seed placeholder. */
export function normalizeJiraDomain(value: string | null | undefined): string {
  const domain = value?.trim().toLowerCase() ?? "";
  if (!domain || domain === JIRA_DOMAIN_PLACEHOLDER) return "";
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(domain)) {
    return "";
  }
  return domain;
}

export function resolveJiraBrowseDomain(sources: {
  injected?: unknown;
  configured?: string | null;
  published?: string | null;
}): string {
  const injected = typeof sources.injected === "string" ? sources.injected : undefined;
  return (
    normalizeJiraDomain(injected)
    || normalizeJiraDomain(sources.configured)
    || normalizeJiraDomain(sources.published)
  );
}

function injectedJiraDomain(): unknown {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { __DEVHUB_JIRA_DOMAIN?: unknown }).__DEVHUB_JIRA_DOMAIN;
}

/**
 * Direct, external Jira browse URL for a ticket key.
 *
 * The installed app's client bundle cannot see `JIRA_DOMAIN` (and
 * `NEXT_PUBLIC_JIRA_DOMAIN` is fixed at build time, usually empty). The root
 * layout injects the configured domain before hydration so this still points
 * at Atlassian instead of the same-origin redirect — an installed PWA captures
 * same-origin links and opens them in-app, but hands cross-origin links to the
 * system browser. The redirect remains the fallback when no domain is configured.
 */
export function jiraBrowseUrl(key: string): string {
  const domain = resolveJiraBrowseDomain({
    injected: injectedJiraDomain(),
    configured: process.env.JIRA_DOMAIN,
    published: process.env.NEXT_PUBLIC_JIRA_DOMAIN,
  });
  const safeKey = encodeURIComponent(key.trim());
  if (!domain) return `/api/jira/ticket/${safeKey}/redirect`;
  return `https://${domain}/browse/${safeKey}`;
}

/** Blocking head script. Sets the domain the client bundle can actually read. */
export function jiraDomainBootstrapScript(domain: string): string {
  return `self.__DEVHUB_JIRA_DOMAIN=${JSON.stringify(normalizeJiraDomain(domain))};`;
}

export function isPlaceholderJiraUrl(value: string): boolean {
  try {
    return new URL(value).hostname === JIRA_DOMAIN_PLACEHOLDER;
  } catch {
    return false;
  }
}

export function formatTime(date: Date | number | string): string {
  return new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Compact elapsed time since an event (matches sidebar "Synced 1m ago" style). */
export function formatRelativePastAge(ageMs: number): string {
  const mins = Math.round(ageMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/** Compact duration label, e.g. "45s", "5m", "1h 20m". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0m";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function formatRelative(ts: number | null | undefined): string {
  if (!ts) return "\u2014";
  const ms = ts - Date.now();
  if (Math.abs(ms) < 60_000) return ms >= 0 ? "in <1m" : "<1m ago";
  const mins = Math.round(ms / 60_000);
  if (Math.abs(mins) < 60) return mins >= 0 ? `in ${mins}m` : `${-mins}m ago`;
  const hours = Math.round(ms / 3_600_000);
  if (Math.abs(hours) < 24) return hours >= 0 ? `in ${hours}h` : `${-hours}h ago`;
  const days = Math.round(ms / 86_400_000);
  return days >= 0 ? `in ${days}d` : `${-days}d ago`;
}
