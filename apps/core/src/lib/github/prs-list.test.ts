import { expect, it, vi } from "vitest";
import type { GithubPrsApiPayload } from "../../../../../packages/shared/github/pr-types";

const mocks = vi.hoisted(() => ({
  cache: null as GithubPrsApiPayload | null,
  prs: vi.fn(), metadata: vi.fn(),
}));
vi.mock("../integrations/screen-data", () => ({ githubScreen: { prs: mocks.prs, archived: async () => false, recentlyReviewed: async () => [] } }));
vi.mock("../gh-exec", () => ({ isGithubCliAuthenticated: async () => true, mapGithubCliError: () => ({ status: 500, error: "Unavailable" }) }));
vi.mock("../standup/github-merged", () => ({ getGithubLogin: async () => "me" }));
vi.mock("../notes/review-index-server", () => ({ reviewNoteActivityByPath: () => new Map() }));
vi.mock("./skipped-prs", () => ({ listSkippedPrs: () => [] }));
vi.mock("./prs", () => ({
  readGithubPrsListCache: () => mocks.cache,
  readStaleGithubPrsListCache: () => mocks.cache,
  writeGithubPrsListCache: (data: GithubPrsApiPayload) => { mocks.cache = data; },
  fetchPrListMetaByUrl: mocks.metadata,
  fetchPrFeedbackMeta: async () => new Map(),
}));
import { loadGithubPrsList } from "./prs-list";

it("shares initial searches and shows rows while slow detail checks continue", async () => {
  const row = { number: 1, title: "Review me", url: "https://github.com/me/repo/pull/1", repo: "me/repo" };
  mocks.prs.mockResolvedValue({ authored: [], reviews: [row] });
  let complete!: (value: Map<string, object>) => void;
  mocks.metadata.mockReturnValue(new Promise(resolve => { complete = resolve; }));
  const [work, notifications] = await Promise.all([loadGithubPrsList(), loadGithubPrsList()]);
  expect(mocks.prs).toHaveBeenCalledTimes(1);
  expect(mocks.prs).toHaveBeenCalledWith({ includeDetails: false });
  expect(work.reviews).toEqual([row]);
  expect(notifications.detailsState).toBe("pending");
  const details = loadGithubPrsList(true);
  complete(new Map());
  expect((await details).detailsState).toBe("ready");
});
