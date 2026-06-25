import { describe, it, expect } from "vitest";
import {
  DEFAULT_BRIEFING_PREFS,
  DEFAULT_SECTION_VISIBILITY,
  BRIEFING_SECTIONS,
  normalisePrefsUpdate,
} from "./briefing-prefs";

describe("DEFAULT_BRIEFING_PREFS", () => {
  it("has a valid location", () => {
    expect(DEFAULT_BRIEFING_PREFS.location.lat).toBeTypeOf("number");
    expect(DEFAULT_BRIEFING_PREFS.location.lon).toBeTypeOf("number");
    expect(DEFAULT_BRIEFING_PREFS.location.name.length).toBeGreaterThan(0);
  });

  it("has at least one news feed", () => {
    expect(DEFAULT_BRIEFING_PREFS.newsFeeds.length).toBeGreaterThan(0);
    expect(DEFAULT_BRIEFING_PREFS.newsFeeds[0].url).toMatch(/^https?:\/\//);
  });

  it("has all section toggles defined", () => {
    for (const s of BRIEFING_SECTIONS) {
      expect(DEFAULT_SECTION_VISIBILITY).toHaveProperty(s.id);
      expect(typeof DEFAULT_SECTION_VISIBILITY[s.id]).toBe("boolean");
    }
  });
});

describe("normalisePrefsUpdate", () => {
  it("normalises a location object", () => {
    const result = normalisePrefsUpdate({
      location: { name: "Belfast", lat: 54.6, lon: -5.9 },
    });
    expect(result.location).toEqual({ name: "Belfast", lat: 54.6, lon: -5.9 });
  });

  it("falls back to defaults for invalid lat/lon", () => {
    const result = normalisePrefsUpdate({
      location: { name: "X", lat: NaN, lon: "bad" },
    });
    expect(result.location?.lat).toBe(DEFAULT_BRIEFING_PREFS.location.lat);
    expect(result.location?.lon).toBe(DEFAULT_BRIEFING_PREFS.location.lon);
  });

  it("filters empty strings from arrays", () => {
    const result = normalisePrefsUpdate({
      interests: ["F1", "", "space"],
      techStack: ["typescript"],
    });
    expect(result.interests).toEqual(["F1", "space"]);
    expect(result.techStack).toEqual(["typescript"]);
  });

  it("validates section visibility toggles", () => {
    const result = normalisePrefsUpdate({
      sections: { news: false, gaming: true },
    });
    expect(result.sections?.news).toBe(false);
    expect(result.sections?.gaming).toBe(true);
  });

  it("ignores unknown section IDs", () => {
    const result = normalisePrefsUpdate({
      sections: { nonexistent: true, news: false },
    });
    expect(result.sections).not.toHaveProperty("nonexistent");
    expect(result.sections?.news).toBe(false);
  });

  it("normalises RSS feeds, dropping entries without a URL", () => {
    const result = normalisePrefsUpdate({
      newsFeeds: [
        { url: "https://feed.xml", label: "Test" },
        { url: "", label: "Empty" },
        { label: "No URL" },
      ],
    });
    expect(result.newsFeeds).toEqual([{ url: "https://feed.xml", label: "Test" }]);
  });

  it("handles booleans and strings correctly", () => {
    const result = normalisePrefsUpdate({
      hasKids: true,
      attractionsArea: "Scotland",
      newsRegion: "US:en",
    });
    expect(result.hasKids).toBe(true);
    expect(result.attractionsArea).toBe("Scotland");
    expect(result.newsRegion).toBe("US:en");
  });

  it("returns empty object for no valid fields", () => {
    expect(normalisePrefsUpdate({})).toEqual({});
    expect(normalisePrefsUpdate({ garbage: true })).toEqual({});
  });
});
