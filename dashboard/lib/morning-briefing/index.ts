/**
 * Morning briefing public surface — types, weather, RSS parsers, formatters, tips.
 * Implementation split across sibling modules; `@/lib/morning-briefing` stays stable.
 */
export type {
  WeatherDay,
  WeatherInfo,
  LinkItem,
  RepoItem,
  OnThisDayItem,
  HackerNewsItem,
  DevTip,
  InterestSnippet,
  ResearchSignal,
  ResearchCard,
  DailyBriefing,
} from "./types";
export { forecastDayLabel, briefingIsEmpty } from "./types";

export type { WeatherIconName, WeatherTheme } from "./weather";
export {
  describeWeatherCode,
  weatherIconName,
  weatherTheme,
} from "./weather";

export type { RssItem } from "./rss";
export {
  decodeEntities,
  parseRssItems,
  parseGithubTrendingRepos,
  splitGoogleNewsTitle,
  parseDiscoverNiEvents,
} from "./rss";

export { formatStars, relativeTime, buildBriefingSummary } from "./format";

export type { Attraction } from "./tips";
export { DEV_TIPS, pickDevTip, FAMILY_ATTRACTIONS, attractionMapsUrl } from "./tips";
