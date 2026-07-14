import { describe, it, expect } from "vitest";
import { renderCanvasDocument } from "./briefing-canvas";
import type { BriefingContext } from "./briefing-context";

function ctx(overrides: Partial<BriefingContext> = {}): BriefingContext {
  return {
    date: "2026-07-09",
    generatedAt: "2026-07-09T06:00:00.000Z",
    location: { name: "Blackwatertown", lat: 54.4, lon: -6.7 },
    profile: { techStack: [], interests: [], hasKids: false },
    weather: null,
    news: [],
    events: [],
    github: [],
    hackerNews: [],
    gaming: [],
    onThisDay: [],
    interests: [],
    research: [],
    feeds: [],
    summary: "Quiet day.",
    ...overrides,
  };
}

describe("renderCanvasDocument", () => {
  it("injects window.__BRIEFING__ with the data before </head>", () => {
    const out = renderCanvasDocument("<!doctype html><html><head></head><body></body></html>", ctx());
    expect(out).toContain("window.__BRIEFING__=");
    expect(out).toContain("window.__BRIEFING_REFRESH__");
    expect(out).toContain("Blackwatertown");
    // boot script sits inside <head>
    expect(out.indexOf("window.__BRIEFING__=")).toBeLessThan(out.indexOf("</head>"));
  });

  it("escapes < so hostile feed/news text can't break out of the script tag", () => {
    const out = renderCanvasDocument(
      "<html><head></head><body></body></html>",
      ctx({ news: [{ title: "</script><script>alert(1)</script>", url: "https://x.test" }] }),
    );
    // The only real </script> is the boot tag's own closer — the injected data is neutralised.
    expect(out).not.toContain("<script>alert(1)");
    expect(out).toContain("\\u003c/script>\\u003cscript>alert(1)");
  });

  it("falls back to injecting after <body> when there is no <head>", () => {
    const out = renderCanvasDocument("<body><div>hi</div></body>", ctx());
    expect(out).toContain("window.__BRIEFING__=");
    expect(out.indexOf("<body>")).toBeLessThan(out.indexOf("window.__BRIEFING__="));
  });
});
