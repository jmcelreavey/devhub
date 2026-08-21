import { describe, it, expect } from "vitest";
import {
  canvasRegenFailureMessage,
  extractHtmlDocument,
  renderCanvasDocument,
} from "./briefing-canvas";
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


describe("canvasRegenFailureMessage", () => {
  it("includes the real generation error", () => {
    expect(canvasRegenFailureMessage({ configured: true, error: "Workspace Trust Required" })).toContain(
      "Workspace Trust Required",
    );
    expect(canvasRegenFailureMessage({ configured: true })).not.toMatch(/try again in a moment/i);
  });
});

describe("extractHtmlDocument", () => {
  const doc = `<!doctype html>\n<html lang="en"><head><title>t</title></head><body>hi</body></html>`;

  it("drops a commentary preamble before the doctype", () => {
    // Observed verbatim: the model narrated the change, then emitted the page.
    const reply = `Softening the backdrop and confirming the block stays out. Returning the full revised document.${doc}`;
    expect(extractHtmlDocument(reply)).toBe(doc);
  });

  it("drops a sign-off after the closing tag", () => {
    expect(extractHtmlDocument(`${doc}\n\nLet me know if you want it lighter.`)).toBe(doc);
  });

  it("still strips markdown fences", () => {
    expect(extractHtmlDocument("```html\n" + doc + "\n```")).toBe(doc);
  });

  it("falls back to <html> when there is no doctype", () => {
    const noDoctype = "<html><body>hi</body></html>";
    expect(extractHtmlDocument(`Here you go: ${noDoctype}`)).toBe(noDoctype);
  });

  it("leaves a reply with no document alone", () => {
    expect(extractHtmlDocument("I could not build that.")).toBe("I could not build that.");
  });

  it("returns a document that starts at the doctype", () => {
    expect(extractHtmlDocument(`prose${doc}`).startsWith("<!doctype html>")).toBe(true);
  });
});
