import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  STALE_CACHE_MAX_AGE_MS,
  invalidateGithubPrsCache,
  readGithubPrsListCache,
  readStaleGithubPrsListCache,
  writeGithubPrsListCache,
  type GithubPrsApiPayload,
} from "./prs";

const sample: GithubPrsApiPayload = {
  configured: true,
  authored: [{ number: 1, title: "feat", url: "https://github.com/o/r/pull/1", repo: "o/r" }],
  reviews: [],
  recentlyReviewed: [],
};

describe("github prs list cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invalidateGithubPrsCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns fresh cache within TTL", () => {
    writeGithubPrsListCache(sample);
    expect(readGithubPrsListCache()).toEqual(sample);
    expect(readStaleGithubPrsListCache()).toEqual(sample);
  });

  it("readStaleGithubPrsListCache survives TTL expiry", () => {
    writeGithubPrsListCache(sample);
    vi.advanceTimersByTime(3 * 60 * 1000);
    expect(readGithubPrsListCache()).toBeNull();
    expect(readStaleGithubPrsListCache()).toEqual(sample);
  });

  /**
   * Serving a day-old list as "stale" is worse than an error — it reads as
   * current, and the user has no cue that it predates their last three pushes.
   */
  it("stops serving the cache once it is older than the stale window", () => {
    writeGithubPrsListCache(sample);
    vi.advanceTimersByTime(STALE_CACHE_MAX_AGE_MS - 1);
    expect(readStaleGithubPrsListCache()).toEqual(sample);

    vi.advanceTimersByTime(1);
    expect(readStaleGithubPrsListCache()).toBeNull();
  });

  it("has nothing to serve before the first successful fetch", () => {
    expect(readStaleGithubPrsListCache()).toBeNull();
  });
});
