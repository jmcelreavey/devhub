import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ repos: vi.fn(), radar: vi.fn() }));
vi.mock("@/lib/ownership/owned-repos", () => ({ resolveOwnedRepos: mocks.repos }));
vi.mock("@/lib/ownership/service", () => ({ loadPrRadar: mocks.radar }));
vi.mock("@/lib/api-utils", () => ({ withErrorHandler: (handler: unknown) => handler }));
import { GET } from "./route";
const a = { fullName: "acme/app" };
const b = { fullName: "acme/other" };
beforeEach(() => { vi.clearAllMocks(); mocks.repos.mockResolvedValue([a, b]); });
describe("shared Owned PR inventory", () => {
  it("uses the existing ownership registry and radar, including PRs not authored or requested by me", async () => {
    mocks.radar.mockImplementation(async (repo) => [{ number: repo === a ? 1 : 2, title: "Peer PR", url: `https://github.com/${repo.fullName}/pull/1`, author: { login: "peer" }, updatedAt: "2026-10-18", createdAt: "2026-10-17", isDraft: true, checks: "pending" }]);
    const response = await (await GET()).json();
    expect(mocks.repos).toHaveBeenCalledOnce();
    expect(mocks.radar).toHaveBeenCalledWith(a);
    expect(mocks.radar).toHaveBeenCalledWith(b);
    expect(response.prs).toHaveLength(2);
    expect(response.prs[0]).toMatchObject({ repo: "acme/app", author: { login: "peer" }, draft: true, prState: "open" });
    expect(response.failedRepos).toEqual([]);
  });
  it("returns successful repos with explicit partial failure instead of claiming zero", async () => {
    mocks.radar.mockRejectedValue(new Error("GitHub unavailable"));
    const response = await (await GET()).json();
    expect(response.failedRepos).toEqual(["acme/app", "acme/other"]);
    expect(response.prs).toEqual([]);
  });
  it("marks the existing reader's upstream cap as a lower bound", async () => {
    mocks.radar.mockResolvedValue(Array.from({ length: 100 }, (_, n) => ({ number: n, author: { login: "peer" } })));
    expect((await (await GET()).json()).limited).toBe(true);
  });
  it("does no GitHub work for an empty Owned registry", async () => {
    mocks.repos.mockResolvedValue([]);
    expect(await (await GET()).json()).toEqual({ prs: [], failedRepos: [], limited: false });
    expect(mocks.radar).not.toHaveBeenCalled();
  });
});
