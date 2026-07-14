// Network fetchers for the daily briefing. Every source is free and key-less,
// uses a short timeout, and resolves to an empty result on any failure so one
// flaky feed never sinks the whole briefing. The pure parsing/formatting helpers
// live in sibling modules under ./morning-briefing/.
//
// All functions are parameterised by BriefingPrefs so the same code serves any
// user's location and feeds. The defaults live in briefing-prefs.ts.

import type {
  HackerNewsItem,
  InterestSnippet,
  LinkItem,
  OnThisDayItem,
  RepoItem,
  WeatherDay,
  WeatherInfo,
} from "./types";
import { forecastDayLabel } from "./types";
import { describeWeatherCode } from "./weather";
import {
  parseDiscoverNiEvents,
  parseGithubTrendingRepos,
  parseRssItems,
  splitGoogleNewsTitle,
} from "./rss";
import { relativeTime } from "./format";
import type { BriefingLocation, BriefingPrefs, RssFeed } from "../briefing-prefs";

const UA = "DevHub-Dashboard-Briefing/1.0 (+https://github.com/anomalyco/opencode)";
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TIMEOUT_MS = 8000;

async function fetchText(url: string, headers: Record<string, string> = {}): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, ...headers },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson<T>(url: string, headers: Record<string, string> = {}): Promise<T | null> {
  const text = await fetchText(url, { Accept: "application/json", ...headers });
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

// ── Weather (Open-Meteo) ─────────────────────────────────────────────────────

interface OpenMeteoResponse {
  current?: { temperature_2m?: number; weather_code?: number; wind_speed_10m?: number };
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
    sunrise?: string[];
    sunset?: string[];
  };
}

export async function fetchWeather(location: BriefingLocation): Promise<WeatherInfo | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${location.lat}&longitude=${location.lon}` +
    `&current=temperature_2m,weather_code,wind_speed_10m` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset` +
    `&timezone=auto&forecast_days=3`;
  const data = await fetchJson<OpenMeteoResponse>(url);
  if (!data?.current || typeof data.current.temperature_2m !== "number") return null;

  const daily = data.daily;
  const times = daily?.time ?? [];
  const dayCount = Math.min(3, times.length || daily?.weather_code?.length || 0);

  const days: WeatherDay[] = [];
  for (let i = 0; i < dayCount; i++) {
    const code = daily?.weather_code?.[i] ?? 0;
    const date = times[i] ?? "";
    days.push({
      date,
      label: forecastDayLabel(i, date),
      code,
      highC: daily?.temperature_2m_max?.[i] ?? data.current.temperature_2m,
      lowC: daily?.temperature_2m_min?.[i] ?? data.current.temperature_2m,
      description: describeWeatherCode(code).description,
      precipProbability: daily?.precipitation_probability_max?.[i] ?? null,
    });
  }

  if (days.length === 0) {
    const code = data.current.weather_code ?? 0;
    days.push({
      date: "",
      label: "Today",
      code,
      highC: data.current.temperature_2m,
      lowC: data.current.temperature_2m,
      description: describeWeatherCode(code).description,
      precipProbability: null,
    });
  }

  return {
    location: location.name,
    currentTempC: data.current.temperature_2m,
    windKph:
      typeof data.current.wind_speed_10m === "number" ? Math.round(data.current.wind_speed_10m) : null,
    sunrise: daily?.sunrise?.[0] ?? null,
    sunset: daily?.sunset?.[0] ?? null,
    days,
  };
}

// ── News (configurable RSS feeds) ────────────────────────────────────────────

export async function fetchNews(feeds: RssFeed[], limit = 20): Promise<LinkItem[]> {
  if (feeds.length === 0) return [];
  const xmls = await Promise.all(feeds.map((f) => fetchText(f.url)));

  const items: Array<{ item: LinkItem; ts: number }> = [];
  xmls.forEach((xml, idx) => {
    if (!xml) return;
    const source = feeds[idx].label;
    for (const i of parseRssItems(xml, limit)) {
      items.push({
        item: { title: i.title, url: i.link, source, meta: relativeTime(i.pubDate) },
        ts: i.pubDate ? Date.parse(i.pubDate) || 0 : 0,
      });
    }
  });

  return items
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit)
    .map((entry) => entry.item);
}

// ── Local events ─────────────────────────────────────────────────────────────
// Two strategies: Discover NI scraping (NI only) and Google News RSS (anywhere).
// For non-NI users we fall straight to Google News scoped to their area.

const DNI_EVENT_PAGES = [
  "https://discovernorthernireland.com/destinations/county-armagh/whats-on/",
  "https://discovernorthernireland.com/destinations/county-tyrone/whats-on/",
  "https://discovernorthernireland.com/whats-on/family-events/",
];

export async function fetchDiscoverNiEvents(limit = 20): Promise<LinkItem[]> {
  const pages = await Promise.all(
    DNI_EVENT_PAGES.map((u) => fetchText(u, { "User-Agent": BROWSER_UA, Accept: "text/html" })),
  );
  const seen = new Set<string>();
  const out: LinkItem[] = [];
  for (const html of pages) {
    if (!html) continue;
    for (const ev of parseDiscoverNiEvents(html, limit)) {
      if (seen.has(ev.url)) continue;
      seen.add(ev.url);
      out.push(ev);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Google News events search scoped to the user's areas + interests. */
export async function fetchLocalEvents(
  searchAreas: string[],
  interests: string[],
  region: string,
  hasKids: boolean,
  limit = 20,
): Promise<LinkItem[]> {
  const areaQuery = searchAreas.length > 0 ? `(${searchAreas.join(" OR ")})` : "";
  const interestTerms = interests.length > 0
    ? interests.slice(0, 6).join(" OR ")
    : "";
  const familyTerms = hasKids
    ? `"things to do" OR "days out" OR family OR kids OR children OR "soft play" OR farm OR playground`
    : `"things to do" OR event OR festival OR market OR fair OR "what's on"`;

  const parts = [areaQuery, familyTerms, interestTerms].filter(Boolean);
  const query = parts.join(" ");
  const url =
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}` +
    `&hl=en&gl=${region.split(":")[0] || "GB"}&ceid=${region}`;
  const xml = await fetchText(url);
  if (!xml) return [];
  return parseRssItems(xml, limit).map((i) => {
    const { title, source } = splitGoogleNewsTitle(i.title);
    return { title, url: i.link, source: source ?? "Google News", meta: relativeTime(i.pubDate) };
  });
}

/** Events: Discover NI (if NI) → Google News fallback. */
export async function fetchEvents(prefs: BriefingPrefs, limit = 20): Promise<LinkItem[]> {
  const isNi = prefs.location.name.includes("Northern Ireland") ||
    prefs.eventSearchAreas.some((a) =>
      ["armagh", "tyrone", "belfast", "derry", "lisburn", "newry", "portadown", "lurgan", "dungannon", "craigan"].some(
        (ni) => a.toLowerCase().includes(ni),
      ),
    );
  if (isNi) {
    const dni = await fetchDiscoverNiEvents(limit);
    if (dni.length > 0) return dni;
  }
  return fetchLocalEvents(prefs.eventSearchAreas, prefs.interests, prefs.newsRegion, prefs.hasKids, limit);
}

// ── Interest cards (Google News RSS, one card per user interest) ─────────────

function interestQuery(interest: string): string {
  const trimmed = interest.trim();
  if (/^ascension$/i.test(trimmed) || (/ascension/i.test(trimmed) && /warcraft|wow|private/i.test(trimmed))) {
    return `("Project Ascension" OR "Ascension WoW" OR "World of Warcraft private server")`;
  }
  if (/image.*comic|image publisher/i.test(trimmed)) {
    return `("Image Comics" OR "Image comic books")`;
  }
  return `"${trimmed.replace(/"/g, "")}"`;
}

export async function fetchInterestSnippets(
  interests: string[],
  region: string,
  limitPerInterest = 3,
): Promise<InterestSnippet[]> {
  const unique = [...new Set(interests.map((i) => i.trim()).filter(Boolean))].slice(0, 8);
  if (unique.length === 0) return [];

  const gl = region.split(":")[0] || "GB";
  const cards: Array<InterestSnippet | null> = await Promise.all(
    unique.map(async (interest) => {
      const query = `${interestQuery(interest)} when:14d`;
      const url =
        `https://news.google.com/rss/search?q=${encodeURIComponent(query)}` +
        `&hl=en&gl=${gl}&ceid=${region}`;
      const xml = await fetchText(url);
      if (!xml) return null;
      const links: LinkItem[] = parseRssItems(xml, limitPerInterest).map((i) => {
        const { title, source } = splitGoogleNewsTitle(i.title);
        return { title, url: i.link, source: source ?? "Google News", meta: relativeTime(i.pubDate) };
      });
      if (links.length === 0) return null;
      return {
        interest,
        text: `Latest results for ${interest}`,
        links,
      } satisfies InterestSnippet;
    }),
  );

  return cards.filter((card): card is InterestSnippet => card !== null);
}

// ── Trending GitHub repos ────────────────────────────────────────────────────

export async function fetchTrendingRepos(limit = 20): Promise<RepoItem[]> {
  const html = await fetchText("https://github.com/trending?since=daily", {
    "User-Agent": BROWSER_UA,
    Accept: "text/html",
  });
  return html ? parseGithubTrendingRepos(html, limit) : [];
}

// ── Gaming news (configurable RSS feeds) ─────────────────────────────────────

export async function fetchGamingNews(feeds: RssFeed[], limit = 20): Promise<LinkItem[]> {
  if (feeds.length === 0) return [];
  const xmls = await Promise.all(feeds.map((f) => fetchText(f.url)));

  const items: Array<{ item: LinkItem; ts: number }> = [];
  xmls.forEach((xml, idx) => {
    if (!xml) return;
    for (const i of parseRssItems(xml, limit)) {
      items.push({
        item: {
          title: i.title,
          url: i.link,
          source: feeds[idx].label,
          meta: relativeTime(i.pubDate),
        },
        ts: i.pubDate ? Date.parse(i.pubDate) || 0 : 0,
      });
    }
  });

  return items
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit)
    .map((entry) => entry.item);
}

// ── Hacker News top stories (official Firebase API) ──────────────────────────

interface HnItem {
  id?: number;
  title?: string;
  url?: string;
  score?: number;
  descendants?: number;
  type?: string;
}

export async function fetchHackerNews(limit = 20): Promise<HackerNewsItem[]> {
  const ids = await fetchJson<number[]>("https://hacker-news.firebaseio.com/v0/topstories.json");
  if (!ids?.length) return [];

  const stories = await Promise.all(
    ids.slice(0, limit).map((id) =>
      fetchJson<HnItem>(`https://hacker-news.firebaseio.com/v0/item/${id}.json`),
    ),
  );

  const out: HackerNewsItem[] = [];
  for (const s of stories) {
    if (!s?.id || !s.title) continue;
    const commentsUrl = `https://news.ycombinator.com/item?id=${s.id}`;
    out.push({
      title: s.title,
      url: s.url ?? commentsUrl,
      score: s.score ?? 0,
      comments: s.descendants ?? 0,
      commentsUrl,
    });
  }
  return out;
}

// ── On this day (Wikimedia feed API) ─────────────────────────────────────────

interface OnThisDayResponse {
  selected?: Array<{
    year?: number;
    text?: string;
    pages?: Array<{ content_urls?: { desktop?: { page?: string } } }>;
  }>;
}

export async function fetchOnThisDay(date: Date, limit = 12): Promise<OnThisDayItem[]> {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const url = `https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/selected/${mm}/${dd}`;
  const data = await fetchJson<OnThisDayResponse>(url);
  if (!data?.selected) return [];
  return data.selected
    .filter((s) => typeof s.year === "number" && s.text)
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
    .slice(0, limit)
    .map((s) => ({
      year: s.year as number,
      text: s.text as string,
      url: s.pages?.[0]?.content_urls?.desktop?.page,
    }));
}
