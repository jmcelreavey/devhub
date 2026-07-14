/**
 * Assemble a BriefingContext from prefs + live sources.
 * Caching / prompt projection live in briefing-context.ts — this is the fetch stitch.
 */
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
  buildBriefingSummary,
  type DailyBriefing,
  type HackerNewsItem,
  type InterestSnippet,
  type LinkItem,
  type OnThisDayItem,
  type RepoItem,
  type ResearchCard,
  type WeatherInfo,
} from "@/lib/morning-briefing";
import type { BriefingPrefs } from "@/lib/briefing-prefs";
import { loadResearchCards } from "@/lib/briefing-research";
import { fetchDynamicFeeds, type FeedResult } from "@/lib/briefing-feeds";
import { runLast30DaysForInterests } from "@/lib/last30days-runner";
import { todayISO } from "@/lib/utils";

export interface BriefingContext {
  date: string;
  generatedAt: string;
  location: { name: string; lat: number; lon: number };
  profile: { techStack: string[]; interests: string[]; hasKids: boolean };
  weather: WeatherInfo | null;
  news: LinkItem[];
  events: LinkItem[];
  github: RepoItem[];
  hackerNews: HackerNewsItem[];
  gaming: LinkItem[];
  onThisDay: OnThisDayItem[];
  interests: InterestSnippet[];
  research: ResearchCard[];
  feeds: FeedResult[];
  /** Plain-text one-liner, kept for the home-screen widget + focus view. */
  summary: string;
}

async function settle<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

/**
 * Fetch every briefing source and stitch into one context object.
 * Does not read/write the day cache — callers own that.
 */
export async function assembleBriefingContext(
  prefs: BriefingPrefs,
  opts: { refresh?: boolean; date?: string } = {},
): Promise<BriefingContext> {
  const date = opts.date ?? todayISO();

  // Cached background research for declared interests (best-effort). Only runs
  // for interests missing a fresh brief unless a full refresh was requested.
  if (prefs.interests.length > 0) {
    await runLast30DaysForInterests(prefs.interests, { onlyMissing: !opts.refresh }).catch(() => null);
  }

  const [weather, news, events, github, hackerNews, gaming, onThisDay, interests, feeds] = await Promise.all([
    settle(fetchWeather(prefs.location), null as WeatherInfo | null),
    settle(fetchNews(prefs.newsFeeds, 24), [] as LinkItem[]),
    settle(fetchEvents(prefs, 24), [] as LinkItem[]),
    settle(fetchTrendingRepos(20), [] as RepoItem[]),
    settle(fetchHackerNews(20), [] as HackerNewsItem[]),
    settle(fetchGamingNews(prefs.gamingFeeds, 16), [] as LinkItem[]),
    settle(fetchOnThisDay(new Date(), 12), [] as OnThisDayItem[]),
    settle(fetchInterestSnippets(prefs.interests, prefs.newsRegion), [] as InterestSnippet[]),
    settle(fetchDynamicFeeds(10), [] as FeedResult[]),
  ]);

  const research = loadResearchCards(prefs.interests);
  const generatedAt = new Date().toISOString();

  const forSummary: DailyBriefing = {
    weather,
    devTip: null,
    news,
    events,
    github,
    hackerNews,
    gaming,
    onThisDay,
    aiSummary: null,
    bespokeHtml: null,
    researchCards: research,
    interestSnippets: interests,
  };

  return {
    date,
    generatedAt,
    location: prefs.location,
    profile: { techStack: prefs.techStack, interests: prefs.interests, hasKids: prefs.hasKids },
    weather,
    news,
    events,
    github,
    hackerNews,
    gaming,
    onThisDay,
    interests,
    research,
    feeds,
    summary: buildBriefingSummary(forSummary),
  };
}
