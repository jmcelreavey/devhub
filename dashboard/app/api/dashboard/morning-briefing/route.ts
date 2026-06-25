import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  fetchEvents,
  fetchGamingNews,
  fetchHackerNews,
  fetchInterestSnippets,
  fetchNews,
  fetchOnThisDay,
  fetchTrendingRepos,
  fetchWeather,
} from "@/lib/morning-briefing-sources";
import {
  generateAiDevTip,
  generateAiSummary,
} from "@/lib/briefing-ai";
import { buildBriefingSummary, type DailyBriefing } from "@/lib/morning-briefing";
import { readBriefingPrefs } from "@/lib/briefing-prefs";
import { getRepoRoot } from "@/lib/notes-dir";
import { writeAtomic, safeReadJSON } from "@/lib/atomic-write";
import { todayISO } from "@/lib/utils";
import { withErrorHandler } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

const CACHE_VERSION = 6;

interface CachedBriefing {
  date: string;
  text: string;
  briefing: DailyBriefing;
  generatedAt: string;
}

function cacheFile(date: string): string {
  return path.join(getRepoRoot(), "notes", ".cache", "briefing", `v${CACHE_VERSION}-${date}.json`);
}

async function settle<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

const NO_STORE = { "Cache-Control": "no-store, max-age=0" } as const;

export const GET = withErrorHandler(async (request: Request) => {
  const date = todayISO();
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  const prefs = readBriefingPrefs();
  const s = prefs.sections;

  if (!refresh) {
    const cached = safeReadJSON<CachedBriefing | null>(cacheFile(date), null);
    if (cached && cached.date === date && cached.briefing) {
      return NextResponse.json(
        { ok: true, text: cached.text, briefing: cached.briefing, generatedAt: cached.generatedAt, cached: true, prefs },
        { headers: NO_STORE },
      );
    }
  }

  // Only fetch sections the user has enabled — saves bandwidth + time.
  const fetchPromises = {
    weather: s.weather ? settle(fetchWeather(prefs.location), null) : Promise.resolve(null),
    news: s.news ? settle(fetchNews(prefs.newsFeeds, 20), []) : Promise.resolve([]),
    events: s.events ? settle(fetchEvents(prefs, 20), []) : Promise.resolve([]),
    github: s.github ? settle(fetchTrendingRepos(prefs.repoLanguages, 20), []) : Promise.resolve([]),
    hackerNews: s.hackerNews ? settle(fetchHackerNews(20), []) : Promise.resolve([]),
    gaming: s.gaming ? settle(fetchGamingNews(prefs.gamingFeeds, 20), []) : Promise.resolve([]),
    onThisDay: s.onThisDay ? settle(fetchOnThisDay(new Date(), 12), []) : Promise.resolve([]),
  };

  const [weather, news, events, github, hackerNews, gaming, onThisDay] = await Promise.all([
    fetchPromises.weather,
    fetchPromises.news,
    fetchPromises.events,
    fetchPromises.github,
    fetchPromises.hackerNews,
    fetchPromises.gaming,
    fetchPromises.onThisDay,
  ]);

  // AI enrichment (additive — falls back gracefully when AI is unconfigured).
  const [devTip, aiSummary, interestSnippets] = await Promise.all([
    s.devTip ? generateAiDevTip(prefs.techStack, new Date()) : Promise.resolve(null),
    generateAiSummary(
      { weather, devTip: null, news, events, github, hackerNews, gaming, onThisDay, aiSummary: null, interestSnippets: [] },
      { techStack: prefs.techStack, interests: prefs.interests },
    ),
    s.interests ? settle(fetchInterestSnippets(prefs.interests, prefs.newsRegion), []) : Promise.resolve([]),
  ]);

  const briefing: DailyBriefing = {
    weather,
    devTip,
    news,
    events,
    github,
    hackerNews,
    gaming,
    onThisDay,
    aiSummary,
    interestSnippets,
  };
  const text = buildBriefingSummary(briefing);
  const generatedAt = new Date().toISOString();

  try {
    fs.mkdirSync(path.dirname(cacheFile(date)), { recursive: true });
    await writeAtomic(
      cacheFile(date),
      JSON.stringify({ date, text, briefing, generatedAt } satisfies CachedBriefing),
    );
  } catch {
    // Cache is best-effort.
  }

  return NextResponse.json({ ok: true, text, briefing, generatedAt, cached: false, prefs }, { headers: NO_STORE });
}, "dashboard.morning-briefing");
