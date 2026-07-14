// The briefing "context" — the single JSON payload that feeds the bespoke,
// AI-authored canvas. Assembly lives in ./briefing/assemble; this module owns
// the day cache, prompt projection, and the window.__BRIEFING__ contract.

import fs from "node:fs";
import path from "node:path";
import { assembleBriefingContext, type BriefingContext } from "@/lib/briefing/assemble";
import { readBriefingPrefs } from "@/lib/briefing-prefs";
import { getRepoRoot } from "@/lib/notes-dir";
import { writeAtomic, safeReadJSON } from "@/lib/atomic-write";
import { todayISO } from "@/lib/utils";

export type { BriefingContext } from "@/lib/briefing/assemble";
export { assembleBriefingContext } from "@/lib/briefing/assemble";

const CONTEXT_VERSION = 1;

function contextFile(date: string): string {
  return path.join(getRepoRoot(), "notes", ".cache", "briefing", `context-v${CONTEXT_VERSION}-${date}.json`);
}

export function readCachedContext(date = todayISO()): BriefingContext | null {
  const cached = safeReadJSON<BriefingContext | null>(contextFile(date), null);
  return cached && cached.date === date ? cached : null;
}

export async function buildBriefingContext(opts: { refresh?: boolean } = {}): Promise<BriefingContext> {
  const date = todayISO();
  if (!opts.refresh) {
    const cached = readCachedContext(date);
    if (cached) return cached;
  }

  const prefs = readBriefingPrefs();
  const context = await assembleBriefingContext(prefs, { refresh: opts.refresh, date });

  try {
    fs.mkdirSync(path.dirname(contextFile(date)), { recursive: true });
    await writeAtomic(contextFile(date), JSON.stringify(context));
  } catch {
    // Cache is best-effort.
  }

  return context;
}

/**
 * Compact projection of the context for AI prompts — trims each list so the
 * design model gets signal without blowing the token budget.
 */
export function contextForPrompt(ctx: BriefingContext): Record<string, unknown> {
  return {
    date: ctx.date,
    location: ctx.location.name,
    profile: ctx.profile,
    weather: ctx.weather
      ? {
          location: ctx.weather.location,
          currentTempC: Math.round(ctx.weather.currentTempC),
          today: ctx.weather.days[0],
          days: ctx.weather.days,
        }
      : null,
    news: ctx.news.slice(0, 10),
    events: ctx.events.slice(0, 10),
    github: ctx.github.slice(0, 8),
    hackerNews: ctx.hackerNews.slice(0, 8),
    gaming: ctx.gaming.slice(0, 8),
    onThisDay: ctx.onThisDay.slice(0, 5),
    interests: ctx.interests.slice(0, 8),
    research: ctx.research.map((c) => ({
      interest: c.interest,
      title: c.title,
      summary: c.summary,
      signals: c.signals.slice(0, 4),
    })),
    feeds: ctx.feeds.map((f) => ({ id: f.id, label: f.label, items: f.items.slice(0, 8) })),
  };
}

/** The data-key contract the canvas author (AI) can rely on at window.__BRIEFING__. */
export const BRIEFING_DATA_SHAPE = `window.__BRIEFING__ = {
  date: string,                       // ISO date, e.g. "2026-07-09"
  generatedAt: string,                // ISO timestamp
  location: { name, lat, lon },
  profile: { techStack: string[], interests: string[], hasKids: boolean },
  weather: null | {
    location: string, currentTempC: number, windKph: number|null,
    sunrise: string|null, sunset: string|null,
    days: [{ date, label, code, highC, lowC, description, precipProbability }]
  },
  news:        [{ title, url, source?, meta? }],
  events:      [{ title, url, source?, meta? }],
  github:      [{ name, url, description, stars, language }],
  hackerNews:  [{ title, url, score, comments, commentsUrl }],
  gaming:      [{ title, url, source?, meta? }],
  onThisDay:   [{ year, text, url? }],
  interests:   [{ interest, text, links: [{title,url}] }],
  research:    [{ interest, title, summary, updatedAt, sourcePath, signals: [{title,url?,source?,metric?}] }],
  feeds:       [{ id, label, kind, url, items: [{ title, url, source?, meta? }] }],
  summary: string
};
// Same-origin: the canvas may also call fetch('/api/briefing/data?refresh=1')
// or await window.__BRIEFING_REFRESH__() to pull fresh data at runtime.`;
