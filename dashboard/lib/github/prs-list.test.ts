import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { githubScreen } from "@/lib/integrations/screen-data";
import { isGithubCliAuthenticated, mapGithubCliError } from "@/lib/gh-exec";
import { getGithubLogin } from "@/lib/standup/github-merged";
import { reviewNoteActivityByPath } from "@/lib/notes/review-index-server";
import { readGithubPrsListCache, readStaleGithubPrsListCache, writeGithubPrsListCache, type GithubPrRow, type GithubPrsApiPayload } from "./prs";
import { sortReviewRequestedPrs } from "./review-requested-sort";
import { loadGithubPrsList } from "./prs-list";

vi.mock("@/lib/integrations/screen-data", () => ({ githubScreen: { prs: vi.fn(), archived: vi.fn(), recentlyReviewed: vi.fn() } }));
vi.mock("@/lib/gh-exec", () => ({ isGithubCliAuthenticated: vi.fn(), mapGithubCliError: vi.fn() }));
vi.mock("@/lib/standup/github-merged", () => ({ getGithubLogin: vi.fn() }));
vi.mock("@/lib/notes/review-index-server", () => ({ reviewNoteActivityByPath: vi.fn() }));
vi.mock("./prs", () => ({ readGithubPrsListCache: vi.fn(), readStaleGithubPrsListCache: vi.fn(), writeGithubPrsListCache: vi.fn() }));
vi.mock("./review-requested-sort", () => ({ sortReviewRequestedPrs: vi.fn() }));

function pr(number: number, repo = "acme/app"): GithubPrRow {
  return { number, repo, title: `Review ${number}`, url: `https://github.com/${repo}/pull/${number}` };
}
function payload(): GithubPrsApiPayload {
  return { configured: true, generatedAt: "2026-10-18T12:00:00.000Z", authored: [pr(1)], reviews: [pr(2)], recentlyReviewed: [] };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-18T12:00:00Z"));
  vi.mocked(isGithubCliAuthenticated).mockResolvedValue(true);
  vi.mocked(readGithubPrsListCache).mockReturnValue(null);
  vi.mocked(readStaleGithubPrsListCache).mockReturnValue(null);
  vi.mocked(githubScreen.prs).mockResolvedValue({ authored: [], reviews: [] });
  vi.mocked(githubScreen.archived).mockResolvedValue(false);
  vi.mocked(githubScreen.recentlyReviewed).mockResolvedValue([]);
  vi.mocked(getGithubLogin).mockResolvedValue("john");
  vi.mocked(reviewNoteActivityByPath).mockReturnValue(new Map());
  vi.mocked(sortReviewRequestedPrs).mockImplementation((rows) => [...rows]);
  vi.mocked(mapGithubCliError).mockReturnValue({ status: 503, error: "GitHub unavailable" });
});
afterEach(() => vi.useRealTimers());

describe("Home's shared PR list", () => {
  it("keeps the unconfigured response without calling GitHub or a stale cache", async () => {
    vi.mocked(isGithubCliAuthenticated).mockResolvedValue(false);
    expect(await loadGithubPrsList()).toEqual({ configured: false, authored: [], reviews: [], recentlyReviewed: [] });
    expect(githubScreen.prs).not.toHaveBeenCalled();
    expect(readStaleGithubPrsListCache).not.toHaveBeenCalled();
  });

  it("shares the fresh cache and still applies the review-note ordering", async () => {
    const cached = payload();
    vi.mocked(readGithubPrsListCache).mockReturnValue(cached);
    expect(await loadGithubPrsList()).toEqual({ ...cached, cached: true });
    expect(sortReviewRequestedPrs).toHaveBeenCalledWith(cached.reviews, new Map());
    expect(githubScreen.prs).not.toHaveBeenCalled();
    expect(writeGithubPrsListCache).not.toHaveBeenCalled();
  });

  it("filters archived repos from both buckets and excludes listed PRs from recent reviews", async () => {
    const authored = [pr(1), pr(2, "acme/archived")];
    const reviews = [pr(3), pr(4, "acme/archived")];
    vi.mocked(githubScreen.prs).mockResolvedValue({ authored, reviews });
    vi.mocked(githubScreen.archived).mockImplementation(async (repo) => repo === "acme/archived");
    const result = await loadGithubPrsList();
    expect(result).toEqual({ ...payload(), authored: [authored[0]], reviews: [reviews[0]], cached: false });
    expect(githubScreen.archived).toHaveBeenCalledTimes(2);
    expect(githubScreen.recentlyReviewed).toHaveBeenCalledWith("john", new Set([authored[0].url, reviews[0].url]));
    expect(writeGithubPrsListCache).toHaveBeenCalledWith(result);
  });

  it("doesn't fetch recent reviews without a known login", async () => {
    vi.mocked(getGithubLogin).mockResolvedValue(null);
    expect((await loadGithubPrsList()).recentlyReviewed).toEqual([]);
    expect(githubScreen.recentlyReviewed).not.toHaveBeenCalled();
  });

  it("keeps an upstream outage explicitly stale instead of presenting it as new data", async () => {
    const stale = payload();
    vi.mocked(githubScreen.prs).mockRejectedValue(new Error("upstream"));
    vi.mocked(readStaleGithubPrsListCache).mockReturnValue(stale);
    expect(await loadGithubPrsList()).toEqual({ ...stale, cached: true, stale: true, warning: "GitHub unavailable" });
    expect(writeGithubPrsListCache).not.toHaveBeenCalled();
  });

  it.each([401, 404])("doesn't hide a %i behind cached data", async (status) => {
    const error = new Error("request rejected");
    vi.mocked(githubScreen.prs).mockRejectedValue(error);
    vi.mocked(readStaleGithubPrsListCache).mockReturnValue(payload());
    vi.mocked(mapGithubCliError).mockReturnValue({ status, error: "Request rejected" });
    await expect(loadGithubPrsList()).rejects.toBe(error);
    expect(readStaleGithubPrsListCache).not.toHaveBeenCalled();
  });
});
