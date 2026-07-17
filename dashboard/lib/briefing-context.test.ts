import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("@/lib/briefing/assemble", () => ({
  assembleBriefingContext: vi.fn(),
}));

vi.mock("@/lib/briefing-prefs", () => ({
  readBriefingPrefs: vi.fn(() => ({
    location: { name: "Test", lat: 1, lon: 2 },
    interests: [],
    techStack: [],
    hasKids: false,
    newsFeeds: [],
    gamingFeeds: [],
    newsRegion: "GB",
  })),
}));

vi.mock("@/lib/morning-briefing-sources", () => ({
  fetchWeather: vi.fn(),
}));

vi.mock("@/lib/utils", () => ({
  todayISO: () => "2026-07-16",
}));

import { assembleBriefingContext } from "@/lib/briefing/assemble";
import { fetchWeather } from "@/lib/morning-briefing-sources";
import { buildBriefingContext, readCachedContext } from "@/lib/briefing-context";
import type { BriefingContext } from "@/lib/briefing/assemble";
import type { WeatherInfo } from "@/lib/morning-briefing";

const assembleMock = vi.mocked(assembleBriefingContext);
const fetchWeatherMock = vi.mocked(fetchWeather);

function baseContext(overrides: Partial<BriefingContext> = {}): BriefingContext {
  return {
    date: "2026-07-16",
    generatedAt: "2026-07-16T08:00:00.000Z",
    location: { name: "Test", lat: 1, lon: 2 },
    profile: { techStack: [], interests: [], hasKids: false },
    weather: null,
    news: [{ title: "Headline", url: "https://example.com" }],
    events: [],
    github: [],
    hackerNews: [],
    gaming: [],
    onThisDay: [],
    interests: [],
    research: [],
    feeds: [],
    summary: "1 headline",
    ...overrides,
  };
}

const sampleWeather: WeatherInfo = {
  location: "Test",
  currentTempC: 12,
  windKph: 5,
  sunrise: null,
  sunset: null,
  days: [
    {
      date: "2026-07-16",
      label: "Today",
      code: 1,
      highC: 15,
      lowC: 8,
      description: "Mainly clear",
      precipProbability: 10,
    },
  ],
};

describe("buildBriefingContext", () => {
  let tmpRoot: string;
  let prevRepoRoot: string | undefined;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "briefing-context-"));
    prevRepoRoot = process.env.REPO_ROOT;
    process.env.REPO_ROOT = tmpRoot;
    assembleMock.mockReset();
    fetchWeatherMock.mockReset();
  });

  afterEach(() => {
    if (prevRepoRoot === undefined) delete process.env.REPO_ROOT;
    else process.env.REPO_ROOT = prevRepoRoot;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("soft-fills weather when the day cache was poisoned with null", async () => {
    const cacheDir = path.join(tmpRoot, "notes", ".cache", "briefing");
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      path.join(cacheDir, "context-v1-2026-07-16.json"),
      JSON.stringify(baseContext({ weather: null })),
    );

    fetchWeatherMock.mockResolvedValue(sampleWeather);

    const ctx = await buildBriefingContext();
    expect(ctx.weather).toEqual(sampleWeather);
    expect(assembleMock).not.toHaveBeenCalled();
    expect(readCachedContext()?.weather).toEqual(sampleWeather);
  });

  it("returns a complete day cache without reassembling", async () => {
    const cacheDir = path.join(tmpRoot, "notes", ".cache", "briefing");
    fs.mkdirSync(cacheDir, { recursive: true });
    const complete = baseContext({ weather: sampleWeather, summary: "Test 12°C, mainly clear · 1 headline" });
    fs.writeFileSync(path.join(cacheDir, "context-v1-2026-07-16.json"), JSON.stringify(complete));

    const ctx = await buildBriefingContext();
    expect(ctx).toEqual(complete);
    expect(fetchWeatherMock).not.toHaveBeenCalled();
    expect(assembleMock).not.toHaveBeenCalled();
  });
});
