import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/github/auto-pr-review-prefs", () => ({
  readAutoPrReviewPrefs: vi.fn(() => ({ enabled: false, always: false, source: "env" })),
}));

vi.mock("@/lib/gh-exec", () => ({
  isGithubCliAuthenticated: vi.fn(async () => false),
}));

vi.mock("@/lib/github/prs", () => ({
  fetchMyGithubPrs: vi.fn(),
  readGithubPrsListCache: vi.fn(() => null),
}));

vi.mock("@/lib/github/pr-state", () => ({
  fetchPrState: vi.fn(),
}));

vi.mock("@/lib/notes/review-index-server", () => ({
  reviewNoteActivityByPath: vi.fn(() => ({})),
}));

vi.mock("@/lib/github/auto-pr-review", () => ({
  autoReviewConcurrency: vi.fn(() => 1),
  runAutoPrReview: vi.fn(),
}));

const { readAutoPrReviewPrefs } = await import("@/lib/github/auto-pr-review-prefs");
const {
  isWeekdayDaytime,
  startAutoPrReviewPoller,
  stopAutoPrReviewPoller,
  kickAutoPrReviewPoller,
} = await import("./auto-pr-review-poller");

beforeEach(() => {
  vi.mocked(readAutoPrReviewPrefs).mockReturnValue({
    enabled: false,
    always: false,
    source: "env",
  });
});

afterEach(() => {
  stopAutoPrReviewPoller();
  vi.clearAllMocks();
});

describe("isWeekdayDaytime", () => {
  it("is false on Saturday in London", () => {
    // 2026-09-12 is a Saturday
    const sat = new Date("2026-09-12T12:00:00+01:00");
    expect(isWeekdayDaytime(sat, { timeZone: "Europe/London", startHour: 9, endHour: 18 })).toBe(false);
  });

  it("is true on a Wednesday midday in London", () => {
    // 2026-09-16 is a Wednesday
    const wed = new Date("2026-09-16T12:00:00+01:00");
    expect(isWeekdayDaytime(wed, { timeZone: "Europe/London", startHour: 9, endHour: 18 })).toBe(true);
  });

  it("is false before start hour", () => {
    const early = new Date("2026-09-16T08:00:00+01:00");
    expect(isWeekdayDaytime(early, { timeZone: "Europe/London", startHour: 9, endHour: 18 })).toBe(false);
  });
});

describe("startAutoPrReviewPoller", () => {
  it("registers even when prefs say disabled", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    startAutoPrReviewPoller();
    expect(info).toHaveBeenCalledWith(expect.stringContaining("poller registered"));
    expect(info).toHaveBeenCalledWith(expect.stringContaining("disabled"));
    info.mockRestore();
  });

  it("kick re-reads prefs (no throw when disabled)", () => {
    startAutoPrReviewPoller();
    expect(() => kickAutoPrReviewPoller()).not.toThrow();
    expect(readAutoPrReviewPrefs).toHaveBeenCalled();
  });
});
