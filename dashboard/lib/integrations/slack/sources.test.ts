import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prs: vi.fn(), owned: vi.fn(), configured: vi.fn(), week: vi.fn(), authError: vi.fn(), cache: { value: null as { data: unknown; ts: number } | null }, setCache: vi.fn(),
}));
vi.mock("@/lib/github/prs-list", () => ({ loadGithubPrsList: mocks.prs }));
vi.mock("@/lib/github/owned-prs-load", () => ({ loadOwnedPrs: mocks.owned }));
vi.mock("@/lib/ownership/owned-repos", () => ({ listOwnedRepos: () => [{ fullName: "acme/x" }] }));
vi.mock("@/lib/google-calendar", () => ({ isGoogleCalendarConfigured: mocks.configured, getWeekEvents: mocks.week, isGoogleCalendarAuthError: mocks.authError }));
vi.mock("@/lib/calendar-cache", () => ({ CALENDAR_WEEK_TTL_MS: 600_000, getWeekCalendarCache: () => mocks.cache.value, setWeekCalendarCache: mocks.setCache }));
import { loadSlackCalendar } from "./calendar-source";
import { loadSlackPrs } from "./pr-source";

beforeEach(() => { vi.clearAllMocks(); mocks.cache.value = null; mocks.configured.mockReturnValue(true); mocks.authError.mockReturnValue(false); });

describe("loadSlackPrs", () => {
  it("combines my PRs, review requests and the Owned PRs from the same readers the PRs page uses", async () => {
    mocks.prs.mockResolvedValue({ configured: true, authored: [{ number: 1 }], reviews: [{ number: 2 }], recentlyReviewed: [] });
    mocks.owned.mockResolvedValue({ prs: [{ number: 3 }], failedRepos: ["acme/x"], limited: false });
    expect(await loadSlackPrs()).toEqual({ configured: true, authored: [{ number: 1 }], reviews: [{ number: 2 }], owned: [{ number: 3 }], ownedRepos: ["acme/x"], ownedFailed: ["acme/x"], stale: false });
  });
  it("skips Owned when GitHub isn't configured, and reports an unreadable Owned list as unknown rather than empty", async () => {
    mocks.prs.mockResolvedValueOnce({ configured: false, authored: [], reviews: [] });
    expect(await loadSlackPrs()).toMatchObject({ configured: false });
    expect(mocks.owned).not.toHaveBeenCalled();
    mocks.prs.mockResolvedValue({ configured: true, authored: [], reviews: [], stale: true });
    mocks.owned.mockRejectedValue(new Error("down"));
    expect(await loadSlackPrs()).toMatchObject({ owned: undefined, ownedFailed: [], stale: true });
  });
});

describe("loadSlackCalendar", () => {
  it("flattens the week's days and fills the shared cache", async () => {
    mocks.week.mockResolvedValue({ "2026-10-18": [{ id: "a" }], "2026-10-19": [{ id: "b" }] });
    expect(await loadSlackCalendar()).toEqual({ state: "ok", events: [{ id: "a" }, { id: "b" }] });
    expect(mocks.setCache).toHaveBeenCalledTimes(1);
  });
  it("uses a fresh cache and ignores a stale one", async () => {
    mocks.cache.value = { data: { "2026-10-18": [{ id: "cached" }] }, ts: Date.now() };
    expect(await loadSlackCalendar()).toEqual({ state: "ok", events: [{ id: "cached" }] });
    expect(mocks.week).not.toHaveBeenCalled();
    mocks.cache.value = { data: {}, ts: Date.now() - 700_000 };
    mocks.week.mockResolvedValue({});
    await loadSlackCalendar();
    expect(mocks.week).toHaveBeenCalledTimes(1);
  });
  it("says not-configured or needs-reauth, and rethrows anything else", async () => {
    mocks.configured.mockReturnValueOnce(false);
    expect(await loadSlackCalendar()).toEqual({ state: "not-configured" });
    mocks.week.mockRejectedValue(new Error("invalid_grant"));
    mocks.authError.mockReturnValueOnce(true);
    expect(await loadSlackCalendar()).toEqual({ state: "needs-reauth" });
    await expect(loadSlackCalendar()).rejects.toThrow("invalid_grant");
  });
});
