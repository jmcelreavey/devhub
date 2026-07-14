import { describe, it, expect } from "vitest";
import {
  briefingIsEmpty,
  buildBriefingSummary,
  decodeEntities,
  describeWeatherCode,
  attractionMapsUrl,
  formatStars,
  parseDiscoverNiEvents,
  parseGithubTrendingRepos,
  parseRssItems,
  forecastDayLabel,
  FAMILY_ATTRACTIONS,
  pickDevTip,
  relativeTime,
  splitGoogleNewsTitle,
  weatherIconName,
  weatherTheme,
  DEV_TIPS,
  type DailyBriefing,
} from "./morning-briefing";

const EMPTY: DailyBriefing = {
  weather: null,
  devTip: null,
  news: [],
  events: [],
  github: [],
  hackerNews: [],
  gaming: [],
  onThisDay: [],
  aiSummary: null,
  bespokeHtml: null,
  researchCards: [],
  interestSnippets: [],
};

describe("briefingIsEmpty", () => {
  it("is true when every section is empty", () => {
    expect(briefingIsEmpty(EMPTY)).toBe(true);
  });
  it("is false with any content", () => {
    expect(briefingIsEmpty({ ...EMPTY, news: [{ title: "x", url: "u" }] })).toBe(false);
  });
});

describe("describeWeatherCode", () => {
  it("maps known WMO codes", () => {
    expect(describeWeatherCode(0).description).toBe("Clear sky");
    expect(describeWeatherCode(61).description).toBe("Light rain");
  });
  it("falls back for unknown codes", () => {
    expect(describeWeatherCode(1234).description).toBe("Unknown");
  });
});

describe("decodeEntities", () => {
  it("decodes named, decimal and hex entities", () => {
    expect(decodeEntities("Tom &amp; Jerry")).toBe("Tom & Jerry");
    expect(decodeEntities("it&#39;s")).toBe("it's");
    expect(decodeEntities("&#x2728;")).toBe("✨");
  });
});

describe("parseRssItems", () => {
  it("parses RSS 2.0 items with CDATA", () => {
    const xml = `<rss><channel>
      <item><title><![CDATA[Big news]]></title><link>https://e.com/1</link><pubDate>Mon, 22 Jun 2026 08:00:00 GMT</pubDate></item>
      <item><title>Second &amp; story</title><link>https://e.com/2</link></item>
    </channel></rss>`;
    const items = parseRssItems(xml, 5);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: "Big news", link: "https://e.com/1" });
    expect(items[1].title).toBe("Second & story");
  });
  it("parses Atom entries via link href", () => {
    const xml = `<feed><entry><title>Atom post</title><link rel="alternate" href="https://a.com/x"/><published>2026-06-22T08:00:00Z</published></entry></feed>`;
    const items = parseRssItems(xml);
    expect(items[0]).toMatchObject({ title: "Atom post", link: "https://a.com/x" });
  });
  it("skips items missing a link", () => {
    const xml = `<rss><item><title>No link</title></item><item><title>Has link</title><link>https://e.com/ok</link></item></rss>`;
    expect(parseRssItems(xml, 5)).toEqual([
      { title: "Has link", link: "https://e.com/ok", pubDate: undefined },
    ]);
  });
});

describe("parseDiscoverNiEvents", () => {
  const html = `
    <a href="https://discovernorthernireland.com/event/armagh-georgian-weekend/80875101/" title="hero">Learn More</a>
    <h2><a href="https://discovernorthernireland.com/event/armagh-city-summer-walking-tours/83780101/">Armagh City Summer Walking Tours</a></h2> (Thurs 25 Jun)
    <h2><a href="https://discovernorthernireland.com/event/the-archbishops-palace-tour/96415101/">The Archbishop&#39;s Palace Tour</a></h2> (Sun 28 Jun)
    <a href="https://discovernorthernireland.com/event/armagh-city-summer-walking-tours/83780101/"><img src="x.jpg"></a>
  `;
  it("extracts events, dedupes by id, and grabs the date", () => {
    const events = parseDiscoverNiEvents(html);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      title: "Armagh City Summer Walking Tours",
      url: "https://discovernorthernireland.com/event/armagh-city-summer-walking-tours/83780101/",
      source: "Discover NI",
      meta: "Thurs 25 Jun",
    });
    expect(events[1].title).toBe("The Archbishop's Palace Tour");
  });
  it("ignores nav chrome like 'Learn More'", () => {
    const titles = parseDiscoverNiEvents(html).map((e) => e.title);
    expect(titles).not.toContain("Learn More");
  });
  it("respects the limit", () => {
    expect(parseDiscoverNiEvents(html, 1)).toHaveLength(1);
  });
  it("resolves relative hrefs to absolute so links open externally", () => {
    const rel = `<h2><a href="/event/some-fair/55501101/">Some Fair</a></h2> (Fri 3 Jul)`;
    expect(parseDiscoverNiEvents(rel)[0].url).toBe(
      "https://discovernorthernireland.com/event/some-fair/55501101/",
    );
  });
});

describe("parseGithubTrendingRepos", () => {
  it("extracts daily trending repo cards", () => {
    const html = `
      <article class="Box-row">
        <h2 class="h3 lh-condensed">
          <a href="/acme/widgets">
            <span class="text-normal">acme /</span>
            widgets
          </a>
        </h2>
        <p class="col-9 color-fg-muted my-1 pr-4">Tiny &amp; useful widgets.</p>
        <span itemprop="programmingLanguage">TypeScript</span>
        <a href="/acme/widgets/stargazers">1,234</a>
      </article>
      <article class="Box-row">
        <h2><a href="/other/tool"><span>other /</span> tool</a></h2>
      </article>
    `;

    expect(parseGithubTrendingRepos(html, 1)).toEqual([
      {
        name: "acme/widgets",
        url: "https://github.com/acme/widgets",
        description: "Tiny & useful widgets.",
        stars: 1234,
        language: "TypeScript",
      },
    ]);
  });
});

describe("family attractions", () => {
  it("has a curated list", () => {
    expect(FAMILY_ATTRACTIONS.length).toBeGreaterThan(8);
  });
  it("builds a Google Maps URL, using an explicit query when given", () => {
    expect(attractionMapsUrl({ name: "Gosford Forest Park", area: "Markethill", tag: "Forest" })).toBe(
      "https://www.google.com/maps/search/?api=1&query=Gosford%20Forest%20Park%2C%20Markethill%2C%20Northern%20Ireland",
    );
    expect(
      attractionMapsUrl({ name: "Soft play", area: "near Dungannon", tag: "Soft play", query: "soft play near Dungannon" }),
    ).toBe("https://www.google.com/maps/search/?api=1&query=soft%20play%20near%20Dungannon");
  });
  it("uses a custom area when provided", () => {
    expect(
      attractionMapsUrl({ name: "Legoland", area: "Windsor", tag: "Theme park" }, "UK"),
    ).toBe("https://www.google.com/maps/search/?api=1&query=Legoland%2C%20Windsor%2C%20UK");
  });
});

describe("splitGoogleNewsTitle", () => {
  it("splits headline from publisher", () => {
    expect(splitGoogleNewsTitle("Festival returns to Portadown - Belfast Live")).toEqual({
      title: "Festival returns to Portadown",
      source: "Belfast Live",
    });
  });
  it("leaves titles without a trailing source intact", () => {
    expect(splitGoogleNewsTitle("Just a headline")).toEqual({ title: "Just a headline" });
  });
});

describe("formatStars", () => {
  it("formats counts", () => {
    expect(formatStars(42)).toBe("42");
    expect(formatStars(1500)).toBe("1.5k");
    expect(formatStars(2000)).toBe("2k");
    expect(formatStars(125000)).toBe("125k");
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-06-22T12:00:00Z");
  it("formats recent timestamps", () => {
    expect(relativeTime("2026-06-22T11:59:40Z", now)).toBe("just now");
    expect(relativeTime("2026-06-22T11:30:00Z", now)).toBe("30m ago");
    expect(relativeTime("2026-06-22T09:00:00Z", now)).toBe("3h ago");
    expect(relativeTime("2026-06-20T12:00:00Z", now)).toBe("2d ago");
  });
  it("returns undefined for missing/invalid input", () => {
    expect(relativeTime(undefined, now)).toBeUndefined();
    expect(relativeTime("not a date", now)).toBeUndefined();
  });
});

describe("buildBriefingSummary", () => {
  it("summarises populated sections", () => {
    const summary = buildBriefingSummary({
      ...EMPTY,
      weather: {
        location: "Blackwatertown",
        currentTempC: 12.4,
        windKph: 14,
        sunrise: null,
        sunset: null,
        days: [
          {
            date: "2026-06-22",
            label: "Today",
            code: 61,
            highC: 15,
            lowC: 8,
            description: "Light rain",
            precipProbability: 60,
          },
        ],
      },
      news: [{ title: "a", url: "u" }],
      github: [{ name: "o/r", url: "u", description: null, stars: 10, language: "TypeScript" }],
    });
    expect(summary).toContain("Blackwatertown 12°C, light rain");
    expect(summary).toContain("1 headline");
    expect(summary).toContain("1 trending repos");
  });
  it("prefers AI summary when present", () => {
    const summary = buildBriefingSummary({ ...EMPTY, aiSummary: "Rainy day — check the repos." });
    expect(summary).toBe("Rainy day — check the repos.");
  });
  it("has a calm fallback when empty", () => {
    expect(buildBriefingSummary(EMPTY)).toBe("Nothing to report this morning.");
  });
});

describe("pickDevTip", () => {
  it("is deterministic for a given day", () => {
    const d = new Date("2026-06-22T09:00:00Z");
    expect(pickDevTip(d)).toEqual(pickDevTip(d));
  });
  it("changes across days and always returns a real tip", () => {
    const a = pickDevTip(new Date("2026-06-22T09:00:00Z"));
    const b = pickDevTip(new Date("2026-06-23T09:00:00Z"));
    expect(a).not.toBeNull();
    expect(DEV_TIPS).toContainEqual(a);
    expect(a).not.toEqual(b);
  });
  it("returns null for an empty tip list", () => {
    expect(pickDevTip(new Date(), [])).toBeNull();
  });
});

describe("weatherTheme", () => {
  it("treats 20°C+ as hot for Northern Ireland", () => {
    expect(weatherTheme(0, 25).vibe).toMatch(/scorcher|shade/i);
    expect(weatherTheme(1, 21).vibe).toMatch(/warm/i);
  });
  it("calls a clear mid-teens day mild, not hot", () => {
    expect(weatherTheme(0, 16).vibe).toMatch(/mild/i);
  });
  it("flags a hot but overcast day as muggy", () => {
    expect(weatherTheme(3, 24).vibe).toMatch(/muggy|warm/i);
  });
  it("turns moody for rain", () => {
    expect(weatherTheme(63, 11).vibe).toMatch(/brolly|wet/i);
  });
  it("goes icy for snow", () => {
    expect(weatherTheme(73, -1).vibe).toMatch(/snow|warm/i);
  });
  it("always produces a gradient", () => {
    expect(weatherTheme(2, 10).gradient).toContain("linear-gradient");
  });
});

describe("forecastDayLabel", () => {
  it("labels the first two days specially", () => {
    expect(forecastDayLabel(0, "2026-06-22")).toBe("Today");
    expect(forecastDayLabel(1, "2026-06-23")).toBe("Tomorrow");
  });
  it("uses a short weekday after that", () => {
    expect(forecastDayLabel(2, "2026-06-24")).toBe("Wed");
  });
});

describe("weatherIconName", () => {
  it("maps conditions to icon keys", () => {
    expect(weatherIconName(0)).toBe("sun");
    expect(weatherIconName(2)).toBe("cloud-sun");
    expect(weatherIconName(3)).toBe("cloud");
    expect(weatherIconName(48)).toBe("cloud-fog");
    expect(weatherIconName(53)).toBe("cloud-drizzle");
    expect(weatherIconName(63)).toBe("cloud-rain");
    expect(weatherIconName(73)).toBe("cloud-snow");
    expect(weatherIconName(66)).toBe("snowflake");
    expect(weatherIconName(95)).toBe("cloud-lightning");
  });
});
