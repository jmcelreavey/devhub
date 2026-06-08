export function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

export function yesterdayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
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

const DEFAULT_JIRA_DOMAIN = "";

/**
 * Direct, external Jira browse URL for a ticket key. Built client-side so links
 * point straight at Atlassian instead of the same-origin `/api/.../redirect`
 * proxy — an installed PWA captures same-origin links and opens them in-app,
 * but hands cross-origin links to the system browser.
 */
export function jiraBrowseUrl(key: string): string {
  const domain = process.env.NEXT_PUBLIC_JIRA_DOMAIN?.trim() || DEFAULT_JIRA_DOMAIN;
  return `https://${domain}/browse/${key}`;
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
