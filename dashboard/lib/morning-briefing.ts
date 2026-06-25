// Structured "morning briefing" for the dashboard: a personal start-of-day digest
// (local weather, Northern Ireland news, nearby events, trending repos, gaming news,
// and an "on this day" snippet) rather than a work stand-up.
//
// This module holds the pure, network-free pieces — types, the WMO weather-code
// table, a tiny RSS parser, and the formatters/summary builder — so they can be
// unit-tested without hitting the network. The actual fetching lives in
// ./morning-briefing-sources.

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
    b.interestSnippets.length === 0
  );
}

// ── Weather codes ──────────────────────────────────────────────────────────
// WMO weather interpretation codes used by Open-Meteo.
// https://open-meteo.com/en/docs
const WEATHER_CODES: Record<number, { description: string; emoji: string }> = {
  0: { description: "Clear sky", emoji: "☀️" },
  1: { description: "Mainly clear", emoji: "🌤️" },
  2: { description: "Partly cloudy", emoji: "⛅" },
  3: { description: "Overcast", emoji: "☁️" },
  45: { description: "Fog", emoji: "🌫️" },
  48: { description: "Rime fog", emoji: "🌫️" },
  51: { description: "Light drizzle", emoji: "🌦️" },
  53: { description: "Drizzle", emoji: "🌦️" },
  55: { description: "Heavy drizzle", emoji: "🌧️" },
  56: { description: "Freezing drizzle", emoji: "🌧️" },
  57: { description: "Freezing drizzle", emoji: "🌧️" },
  61: { description: "Light rain", emoji: "🌦️" },
  63: { description: "Rain", emoji: "🌧️" },
  65: { description: "Heavy rain", emoji: "🌧️" },
  66: { description: "Freezing rain", emoji: "🌧️" },
  67: { description: "Freezing rain", emoji: "🌧️" },
  71: { description: "Light snow", emoji: "🌨️" },
  73: { description: "Snow", emoji: "❄️" },
  75: { description: "Heavy snow", emoji: "❄️" },
  77: { description: "Snow grains", emoji: "🌨️" },
  80: { description: "Light showers", emoji: "🌦️" },
  81: { description: "Showers", emoji: "🌧️" },
  82: { description: "Violent showers", emoji: "⛈️" },
  85: { description: "Snow showers", emoji: "🌨️" },
  86: { description: "Heavy snow showers", emoji: "❄️" },
  95: { description: "Thunderstorm", emoji: "⛈️" },
  96: { description: "Thunderstorm with hail", emoji: "⛈️" },
  99: { description: "Thunderstorm with hail", emoji: "⛈️" },
};

export function describeWeatherCode(code: number): { description: string; emoji: string } {
  return WEATHER_CODES[code] ?? { description: "Unknown", emoji: "🌡️" };
}

/** Stable keys the widget maps to lucide icon components (keeps the UI icon set consistent). */
export type WeatherIconName =
  | "sun"
  | "cloud-sun"
  | "cloud"
  | "cloud-fog"
  | "cloud-drizzle"
  | "cloud-rain"
  | "cloud-snow"
  | "snowflake"
  | "cloud-lightning";

export function weatherIconName(code: number): WeatherIconName {
  if (code >= 95) return "cloud-lightning";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "cloud-snow";
  if (code === 56 || code === 57 || code === 66 || code === 67) return "snowflake";
  if (code >= 51 && code <= 55) return "cloud-drizzle";
  if ((code >= 61 && code <= 65) || (code >= 80 && code <= 82)) return "cloud-rain";
  if (code === 45 || code === 48) return "cloud-fog";
  if (code === 3) return "cloud";
  if (code === 1 || code === 2) return "cloud-sun";
  return "sun";
}

export interface WeatherTheme {
  /** CSS gradient for the hero background (semi-transparent so it works in both themes). */
  gradient: string;
  /** A short, playful one-liner about the day. */
  vibe: string;
}

/**
 * Pick a mood for the weather hero from the condition code and temperature.
 * Gradients use rgba overlays over the card surface, so they read well in light
 * and dark mode without hard-coding theme colours.
 */
export function weatherTheme(code: number, tempC: number): WeatherTheme {
  // Vivid three-stop diagonal blends. Alphas are high enough to read as real
  // colour in both light and dark mode while staying behind the card text.
  const g = (from: string, mid: string, to: string) =>
    `linear-gradient(135deg, ${from} 0%, ${mid} 55%, ${to} 100%)`;

  // Thunderstorm — electric violet → indigo.
  if (code >= 95) {
    return {
      gradient: g("rgba(167,123,255,0.62)", "rgba(110,80,210,0.42)", "rgba(60,45,120,0.30)"),
      vibe: "Wild skies — keep an eye out.",
    };
  }
  // Snow — icy cyan → white-blue.
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    return {
      gradient: g("rgba(120,205,250,0.60)", "rgba(170,225,250,0.40)", "rgba(232,245,252,0.30)"),
      vibe: "Snow about — wrap up warm.",
    };
  }
  // Rain / drizzle / showers. A warm wet day blends blue → orange — a grand soft day.
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
    if (tempC >= 20) {
      return {
        gradient: g("rgba(64,150,215,0.60)", "rgba(150,170,180,0.40)", "rgba(255,150,55,0.50)"),
        vibe: "Warm and wet — a grand soft day.",
      };
    }
    return {
      gradient: g("rgba(70,150,205,0.58)", "rgba(70,110,165,0.40)", "rgba(50,70,120,0.30)"),
      vibe: "Bring a brolly — it's a wet one.",
    };
  }
  // Fog — soft pewter.
  if (code === 45 || code === 48) {
    return {
      gradient: g("rgba(180,190,205,0.55)", "rgba(150,160,178,0.38)", "rgba(128,138,155,0.26)"),
      vibe: "Murky and grey out there.",
    };
  }
  // Overcast — but a hot, grey day still feels warm/muggy here.
  if (code === 3) {
    if (tempC >= 20) {
      return {
        gradient: g("rgba(240,185,105,0.55)", "rgba(190,180,165,0.38)", "rgba(140,148,160,0.28)"),
        vibe: "Warm but grey — a muggy one.",
      };
    }
    return {
      gradient: g("rgba(165,178,195,0.52)", "rgba(140,152,170,0.36)", "rgba(120,132,150,0.26)"),
      vibe: "Cloud's in for the day.",
    };
  }
  // Clear or mainly/partly clear → warmth scales with temperature.
  // Bands tuned for Northern Ireland, where 20°C+ counts as a hot day.
  if (tempC >= 25) {
    return {
      gradient: g("rgba(255,205,70,0.70)", "rgba(255,140,55,0.52)", "rgba(255,95,75,0.40)"),
      vibe: "Scorcher for here — find some shade.",
    };
  }
  if (tempC >= 20) {
    return {
      gradient: g("rgba(255,210,85,0.66)", "rgba(255,160,60,0.48)", "rgba(255,120,70,0.34)"),
      vibe: "Properly warm for NI — get the shorts out.",
    };
  }
  if (tempC >= 15) {
    return {
      gradient: g("rgba(255,222,110,0.60)", "rgba(190,215,110,0.42)", "rgba(110,200,140,0.32)"),
      vibe: "Lovely and mild — get outside.",
    };
  }
  if (tempC >= 9) {
    return {
      gradient: g("rgba(255,224,140,0.52)", "rgba(160,205,200,0.38)", "rgba(110,180,230,0.34)"),
      vibe: "Fresh and bright — grab a jacket.",
    };
  }
  if (tempC >= 3) {
    return {
      gradient: g("rgba(150,205,245,0.56)", "rgba(175,210,245,0.40)", "rgba(205,225,250,0.30)"),
      vibe: "Crisp and cold — wrap up.",
    };
  }
  return {
    gradient: g("rgba(120,195,245,0.60)", "rgba(165,210,248,0.42)", "rgba(210,232,252,0.32)"),
    vibe: "Bitterly cold — bundle up.",
  };
}

// ── Tiny RSS/Atom parser ─────────────────────────────────────────────────────
// Deliberately dependency-free. Handles RSS 2.0 <item> and Atom <entry>, the
// two shapes every feed we consume uses.

export interface RssItem {
  title: string;
  link: string;
  pubDate?: string;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
};

export function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&[a-zA-Z]+;/g, (m) => ENTITIES[m] ?? m);
}

function unwrap(raw: string): string {
  const cdata = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  const text = cdata ? cdata[1] : raw;
  return decodeEntities(text.replace(/<[^>]+>/g, "")).trim();
}

function tag(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? unwrap(m[1]) : undefined;
}

function atomLink(block: string): string | undefined {
  // Prefer rel="alternate"; fall back to the first <link href="…">.
  const alt = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i);
  if (alt) return decodeEntities(alt[1]);
  const any = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  return any ? decodeEntities(any[1]) : undefined;
}

export function parseRssItems(xml: string, limit = 8): RssItem[] {
  if (!xml) return [];
  const items: RssItem[] = [];
  const blockRe = /<(item|entry)\b[\s\S]*?<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(xml)) && items.length < limit) {
    const block = m[0];
    const title = tag(block, "title");
    const link = tag(block, "link") || atomLink(block);
    if (!title || !link) continue;
    const pubDate = tag(block, "pubDate") || tag(block, "published") || tag(block, "updated");
    items.push({ title, link, pubDate });
  }
  return items;
}

/**
 * Google News RSS titles arrive as "Headline - Publisher". Split the publisher
 * off the end so we can show it as a source label.
 */
export function splitGoogleNewsTitle(title: string): { title: string; source?: string } {
  const idx = title.lastIndexOf(" - ");
  if (idx > 0 && idx > title.length - 60) {
    return { title: title.slice(0, idx).trim(), source: title.slice(idx + 3).trim() };
  }
  return { title: title.trim() };
}

// Anchor text that is navigation chrome, not an event title.
const EVENT_LINK_BLOCKLIST = new Set([
  "learn more",
  "read more",
  "find out more",
  "more info",
  "view all",
  "see all",
  "book now",
  "buy tickets",
  "what's on",
  "sign up now",
  "plan your trip",
]);

const DATE_HINT = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|mon|tue|wed|thu|fri|sat|sun|today|tomorrow|\d{1,2}(st|nd|rd|th)?)\b/i;

/**
 * Parse Tourism NI ("Discover Northern Ireland") what's-on HTML. Events are
 * `/event/<slug>/<id>/` anchors; we dedupe by the numeric id, keep the richest
 * title, and best-effort grab a trailing "(Sat 11 July)" date. Deliberately
 * tolerant of markup churn — it keys off the stable URL shape, not CSS classes.
 */
const DNI_ORIGIN = "https://discovernorthernireland.com";

/** Resolve a possibly-relative scraped href to an absolute URL so links open externally. */
function absoluteUrl(href: string, origin = DNI_ORIGIN): string {
  if (/^https?:\/\//i.test(href)) return href;
  return origin + (href.startsWith("/") ? href : `/${href}`);
}

export function parseDiscoverNiEvents(html: string, limit = 20): LinkItem[] {
  if (!html) return [];
  const re = /<a\b[^>]*href="([^"]*\/event\/[^"]*?\/(\d+)\/?)"[^>]*>([\s\S]*?)<\/a>/gi;
  const byId = new Map<string, LinkItem>();
  const order: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const [, rawUrl, id, inner] = m;
    const url = absoluteUrl(rawUrl);
    const title = decodeEntities(inner.replace(/<[^>]+>/g, "").replace(/\s+/g, " ")).trim();
    if (title.length < 4 || EVENT_LINK_BLOCKLIST.has(title.toLowerCase())) continue;

    const after = html.slice(m.index + m[0].length, m.index + m[0].length + 160);
    const paren = after.match(/\(([^)]{2,40})\)/);
    const meta = paren && DATE_HINT.test(paren[1]) ? paren[1].trim() : undefined;

    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, { title, url, source: "Discover NI", meta });
      order.push(id);
    } else if (title.length > existing.title.length || (!existing.meta && meta)) {
      byId.set(id, {
        title: title.length > existing.title.length ? title : existing.title,
        url: existing.url,
        source: "Discover NI",
        meta: existing.meta ?? meta,
      });
    }
  }
  return order.map((id) => byId.get(id)!).slice(0, limit);
}

// ── Formatters ───────────────────────────────────────────────────────────────

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
  if (b.interestSnippets.length) parts.push(`${b.interestSnippets.length} interest ${b.interestSnippets.length === 1 ? "note" : "notes"}`);
  return parts.length ? parts.join(" · ") : "Nothing to report this morning.";
}

// ── Dev tip / TIL ─────────────────────────────────────────────────────────────
// A curated, dependency-free rotation. One is picked deterministically per day so
// it's stable across reloads but fresh each morning. Skewed toward the JS/TS, git
// and shell workflow this dashboard's owner lives in.
export const DEV_TIPS: DevTip[] = [
  { tag: "git", text: "`git switch -` jumps back to the previous branch — like `cd -` for git." },
  { tag: "git", text: "`git commit --fixup=<sha>` + `git rebase -i --autosquash` folds fixes into the right commit automatically." },
  { tag: "git", text: "`git restore --staged <file>` unstages without touching your working changes." },
  { tag: "git", text: "`git log -S\"someString\"` finds the exact commit that added or removed a string (the 'pickaxe')." },
  { tag: "git", text: "`git worktree add ../hotfix main` checks out a second branch in a sibling folder — no stashing." },
  { tag: "git", text: "`git bisect` binary-searches your history to pinpoint the commit that introduced a bug." },
  { tag: "typescript", text: "`satisfies` validates a value against a type without widening it — you keep the literal inference." },
  { tag: "typescript", text: "Use `as const` on objects/arrays to get readonly literal types instead of widened `string`/`number`." },
  { tag: "typescript", text: "Template literal types let you type things like `` `on${Capitalize<E>}` `` for event-name unions." },
  { tag: "typescript", text: "`Awaited<T>` unwraps nested Promises — handy for typing `ReturnType<typeof asyncFn>`." },
  { tag: "typescript", text: "A discriminated union + exhaustive `switch` with a `never` default catches unhandled cases at compile time." },
  { tag: "javascript", text: "`structuredClone(obj)` deep-clones built-ins (Maps, Dates, typed arrays) — no JSON round-trip needed." },
  { tag: "javascript", text: "`Object.groupBy(items, fn)` groups an array into an object by key, natively." },
  { tag: "javascript", text: "`Array.prototype.at(-1)` reads the last element without `arr[arr.length - 1]`." },
  { tag: "javascript", text: "`Promise.allSettled` waits for every promise and reports each result — failures don't reject the whole batch." },
  { tag: "javascript", text: "Labelled statements let you `break outer;` out of nested loops in one go." },
  { tag: "node", text: "Node 20+ ships a built-in test runner: `node --test`. No dependency required." },
  { tag: "node", text: "`node --watch app.js` restarts on file changes without nodemon." },
  { tag: "node", text: "Set `NODE_OPTIONS=--enable-source-maps` to get original TS line numbers in stack traces." },
  { tag: "shell", text: "`!$` expands to the last argument of the previous command — `mkdir foo && cd !$`." },
  { tag: "shell", text: "`Ctrl-R` reverse-searches your shell history incrementally." },
  { tag: "shell", text: "`cd -` toggles between your two most recent directories." },
  { tag: "shell", text: "`command | tee file.log` shows output and saves it at the same time." },
  { tag: "css", text: "`gap` works in flexbox now, not just grid — drop those margin hacks between children." },
  { tag: "css", text: "`:has()` is a parent selector: `.card:has(img)` styles cards that contain an image." },
  { tag: "css", text: "`clamp(min, preferred, max)` gives fluid type/spacing without media queries." },
  { tag: "web", text: "`<dialog>` gives you a native modal with focus trapping and a backdrop — `showModal()` / `close()`." },
  { tag: "web", text: "`AbortController` cancels fetches: pass `signal` and call `abort()` on cleanup to stop stale requests." },
  { tag: "debug", text: "`console.table(arrayOfObjects)` renders structured data far more readably than `console.log`." },
  { tag: "debug", text: "`console.log({ x, y })` (shorthand) labels each value with its variable name automatically." },
  { tag: "react", text: "A `key` change forces React to remount a component — handy to reset state on route/id change." },
  { tag: "react", text: "Pass a function to `useState(() => expensive())` so the initial value is computed only once." },
];

/** Day-of-year index (1–366), so the tip rotates once per calendar day. */
function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const now = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((now - start) / 86_400_000);
}

/** Deterministic per-day pick from DEV_TIPS. */
export function pickDevTip(date: Date, tips: DevTip[] = DEV_TIPS): DevTip | null {
  if (tips.length === 0) return null;
  return tips[dayOfYear(date) % tips.length];
}

// ── Family days out (curated defaults — overridable via briefing prefs) ──────
// Attractions (farm parks, forests, soft play, playgrounds) are evergreen places,
// not dated events, and tourism sites render listings via JavaScript — so a
// curated local list is both more reliable and more useful than scraping.
// Users can override this area via their briefing preferences.

export interface Attraction {
  name: string;
  area: string;
  tag: string;
  /** Optional explicit maps query; defaults to `${name}, ${area}`. */
  query?: string;
}

/** Default attractions near Co. Armagh, NI — the original curated list. */
export const FAMILY_ATTRACTIONS: Attraction[] = [
  { name: "Tannaghmore Gardens & Animal Farm", area: "Craigavon", tag: "Farm" },
  { name: "Gosford Forest Park", area: "Markethill", tag: "Forest" },
  { name: "Peatlands Park", area: "Dungannon", tag: "Park" },
  { name: "Oxford Island, Lough Neagh Discovery Centre", area: "Craigavon", tag: "Nature" },
  { name: "The Palace Demesne Adventure Playground", area: "Armagh", tag: "Playground" },
  { name: "Armagh Planetarium", area: "Armagh", tag: "Science" },
  { name: "Navan Centre & Fort", area: "Armagh", tag: "Heritage" },
  { name: "Lurgan Park", area: "Lurgan", tag: "Park" },
  { name: "Parkanaur Forest Park", area: "Dungannon", tag: "Forest" },
  { name: "Loughgall Country Park", area: "Loughgall", tag: "Park" },
  { name: "Dungannon Park", area: "Dungannon", tag: "Park" },
  { name: "Clare Glen", area: "Tandragee", tag: "Forest walk" },
  { name: "Todds Leap Activity Centre", area: "Ballygawley", tag: "Adventure" },
  { name: "Soft play centres", area: "near Craigavon", tag: "Soft play", query: "soft play near Craigavon" },
  { name: "Soft play centres", area: "near Dungannon", tag: "Soft play", query: "soft play near Dungannon" },
];

export function attractionMapsUrl(a: Attraction, area = "Northern Ireland"): string {
  const q = a.query ?? `${a.name}, ${a.area}, ${area}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
