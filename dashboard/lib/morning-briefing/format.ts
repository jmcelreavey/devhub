/** Formatters + one-line briefing summary. */
import type { DailyBriefing } from "./types";

export function formatStars(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k`;
}

export function relativeTime(iso: string | undefined, now = new Date()): string | undefined {
  if (!iso) return undefined;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return undefined;
  const diffMin = Math.round((now.getTime() - then) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.round(diffH / 24);
  return `${diffD}d ago`;
}

/** A single compact line for the focus-view strip and notifications. */
export function buildBriefingSummary(b: DailyBriefing): string {
  if (b.aiSummary) return b.aiSummary;
  const parts: string[] = [];
  if (b.weather) {
    const today = b.weather.days[0];
    const desc = today ? `, ${today.description.toLowerCase()}` : "";
    parts.push(`${b.weather.location} ${Math.round(b.weather.currentTempC)}°C${desc}`);
  }
  if (b.news.length) parts.push(`${b.news.length} ${b.news.length === 1 ? "headline" : "headlines"}`);
  if (b.events.length) parts.push(`${b.events.length} local ${b.events.length === 1 ? "event" : "events"}`);
  if (b.github.length) parts.push(`${b.github.length} trending repos`);
  if (b.hackerNews.length) parts.push("HN top stories");
  if (b.gaming.length) parts.push("gaming news");
  if (b.researchCards.length) parts.push(`${b.researchCards.length} research ${b.researchCards.length === 1 ? "brief" : "briefs"}`);
  if (b.interestSnippets.length) parts.push(`${b.interestSnippets.length} interest ${b.interestSnippets.length === 1 ? "note" : "notes"}`);
  return parts.length ? parts.join(" · ") : "Nothing to report this morning.";
}

// ── Dev tip / TIL ─────────────────────────────────────────────────────────────
// A curated, dependency-free rotation. One is picked deterministically per day so
// it's stable across reloads but fresh each morning. Skewed toward the JS/TS, git
// and shell workflow this dashboard's owner lives in.
