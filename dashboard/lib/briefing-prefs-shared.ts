// Client-safe types + constants for briefing preferences.
// Split from briefing-prefs.ts so client components don't pull in node:fs.

export type BriefingSectionId =
  | "weather"
  | "devTip"
  | "news"
  | "events"
  | "github"
  | "hackerNews"
  | "gaming"
  | "onThisDay"
  | "attractions"
  | "research"
  | "interests";

export interface BriefingSectionMeta {
  id: BriefingSectionId;
  label: string;
  description: string;
  defaultEnabled: boolean;
}

export const BRIEFING_SECTIONS: BriefingSectionMeta[] = [
  { id: "weather", label: "Weather", description: "Local forecast for your area", defaultEnabled: true },
  { id: "news", label: "News", description: "Headlines from your RSS feeds", defaultEnabled: true },
  { id: "events", label: "Events", description: "Things to do near you", defaultEnabled: true },
  { id: "github", label: "Trending Repos", description: "Top repos from GitHub Trending today", defaultEnabled: true },
  { id: "hackerNews", label: "Hacker News", description: "Top stories from HN", defaultEnabled: true },
  { id: "gaming", label: "Gaming", description: "Gaming news from RSS feeds", defaultEnabled: false },
  { id: "onThisDay", label: "On This Day", description: "Historical events", defaultEnabled: true },
  { id: "attractions", label: "Family Days Out", description: "Nearby attractions for kids", defaultEnabled: false },
  { id: "research", label: "Background Research", description: "Cached Last30Days briefs for your interests", defaultEnabled: true },
  { id: "interests", label: "Interests", description: "AI-generated insights for your hobbies", defaultEnabled: false },
];

export const DEFAULT_SECTION_VISIBILITY: Record<BriefingSectionId, boolean> = {
  // Retired section — the id stays in BriefingSectionId so previously stored
  // prefs still typecheck, but it never renders and defaults off.
  devTip: false,
  ...Object.fromEntries(BRIEFING_SECTIONS.map((s) => [s.id, s.defaultEnabled])),
} as Record<BriefingSectionId, boolean>;

export interface BriefingLocation {
  name: string;
  lat: number;
  lon: number;
}

export interface RssFeed {
  url: string;
  label: string;
}

export interface BriefingPrefs {
  location: BriefingLocation;
  eventSearchAreas: string[];
  interests: string[];
  techStack: string[];
  hasKids: boolean;
  attractionsArea: string;
  newsFeeds: RssFeed[];
  newsRegion: string;
  repoLanguages: string[];
  gamingFeeds: RssFeed[];
  sections: Record<BriefingSectionId, boolean>;
}

export const DEFAULT_BRIEFING_PREFS: BriefingPrefs = {
  location: { name: "Blackwatertown", lat: 54.4486, lon: -6.7117 },
  eventSearchAreas: ["Blackwatertown", "Moy", "Benburb", "Craigavon", "Portadown", "Dungannon"],
  interests: [],
  techStack: ["typescript", "javascript", "react", "node"],
  hasKids: false,
  attractionsArea: "Northern Ireland",
  newsFeeds: [
    { url: "https://feeds.bbci.co.uk/news/northern_ireland/rss.xml", label: "BBC News NI" },
  ],
  newsRegion: "GB:en",
  repoLanguages: ["TypeScript", "JavaScript"],
  gamingFeeds: [
    { url: "https://www.eurogamer.net/feed", label: "Eurogamer" },
    { url: "https://www.rockpapershotgun.com/feed", label: "Rock Paper Shotgun" },
  ],
  sections: { ...DEFAULT_SECTION_VISIBILITY },
};
