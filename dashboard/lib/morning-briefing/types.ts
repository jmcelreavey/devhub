/** Morning briefing shared types + empty check + forecast labels. */
export interface WeatherDay {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** "Today", "Tomorrow", or a short weekday like "Wed". */
  label: string;
  /** Raw WMO weather code, used for condition-based theming + icon. */
  code: number;
  highC: number;
  lowC: number;
  description: string;
  /** 0–100, or null when the source omitted it. */
  precipProbability: number | null;
}

export interface WeatherInfo {
  location: string;
  /** Current temperature at fetch time (drives the "Today" card). */
  currentTempC: number;
  windKph: number | null;
  sunrise: string | null;
  sunset: string | null;
  /** Today + the next two days. */
  days: WeatherDay[];
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Friendly label for a forecast day given its position in the run. */
export function forecastDayLabel(index: number, dateStr: string): string {
  if (index === 0) return "Today";
  if (index === 1) return "Tomorrow";
  const d = new Date(`${dateStr}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? dateStr : WEEKDAYS[d.getUTCDay()];
}

export interface LinkItem {
  title: string;
  url: string;
  /** Publication / origin, e.g. "BBC News NI" or "Eurogamer". */
  source?: string;
  /** Free-form trailing detail, e.g. a relative timestamp or location. */
  meta?: string;
}

export interface RepoItem {
  /** owner/name */
  name: string;
  url: string;
  description: string | null;
  stars: number;
  language: string | null;
}

export interface OnThisDayItem {
  year: number;
  text: string;
  url?: string;
}

export interface HackerNewsItem {
  title: string;
  /** Article URL, or the HN discussion when the post has no external link. */
  url: string;
  score: number;
  comments: number;
  commentsUrl: string;
}

export interface DevTip {
  text: string;
  tag: string;
  /** True when the tip was AI-generated (vs. the static rotation). */
  aiGenerated?: boolean;
}

/** An AI-generated insight for a user-declared interest (e.g. "F1", "space"). */
export interface InterestSnippet {
  interest: string;
  text: string;
  links: LinkItem[];
}

export interface ResearchSignal {
  title: string;
  url?: string;
  source?: string;
  metric?: string;
  note?: string;
}

export interface ResearchCard {
  interest: string;
  title: string;
  summary: string;
  updatedAt: string;
  sourcePath: string;
  signals: ResearchSignal[];
}

export interface DailyBriefing {
  weather: WeatherInfo | null;
  devTip: DevTip | null;
  news: LinkItem[];
  events: LinkItem[];
  github: RepoItem[];
  hackerNews: HackerNewsItem[];
  gaming: LinkItem[];
  onThisDay: OnThisDayItem[];
  /** AI-generated personalized summary, when AI is configured. */
  aiSummary: string | null;
  /** AI-generated HTML fragment for the bespoke /briefing surface. */
  bespokeHtml: string | null;
  /** Last30Days-style cached research for declared interests. */
  researchCards: ResearchCard[];
  /** AI-generated insights for user interests. */
  interestSnippets: InterestSnippet[];
}

/** True when every section came back empty (so the widget can show a calm fallback). */
export function briefingIsEmpty(b: DailyBriefing): boolean {
  return (
    b.weather === null &&
    b.devTip === null &&
    b.news.length === 0 &&
    b.events.length === 0 &&
    b.github.length === 0 &&
    b.hackerNews.length === 0 &&
    b.gaming.length === 0 &&
    b.onThisDay.length === 0 &&
    b.aiSummary === null &&
    b.bespokeHtml === null &&
    b.researchCards.length === 0 &&
    b.interestSnippets.length === 0
  );
}
