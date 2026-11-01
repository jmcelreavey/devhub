import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ authenticated: vi.fn(), remotePr: vi.fn() }));
vi.mock("../../../../../lib/gh-exec", () => ({ isGithubCliAuthenticated: mocks.authenticated }));
vi.mock("../../../../../lib/github/branch-pr", () => ({ findOpenPrForGithubBranch: mocks.remotePr, findOpenPrForHeadBranch: vi.fn() }));
vi.mock("../../../../../lib/git/repo-local", () => ({ runGitRepoAsync: vi.fn(), resolveDefaultRemoteBranch: vi.fn() }));
vi.mock("../git/_shared", () => ({ withScannedRepo: () => ({ ok: true, repoRoot: "/fixture/repo" }) }));
beforeEach(() => vi.resetAllMocks());

it("authenticates and validates remote branch PR lookups", async () => {
  const base = "http://localhost:1447/api/repos/demo/pr?scope=remote";
  const params = { params: Promise.resolve({ name: "demo" }) };
  const headers = { origin: "http://localhost:1447", host: "localhost:1447" };
  expect([401, 403]).toContain((await GET(new Request(`${base}&repo=a%2Fb&branch=main`), params)).status);
  expect((await GET(new Request(`${base}&repo=a%2Fb&branch=-bad`, { headers }), params)).status).toBe(400);
  expect(mocks.authenticated).not.toHaveBeenCalled();
  mocks.authenticated.mockResolvedValueOnce(true);
  mocks.remotePr.mockResolvedValueOnce({ number: 2 });
  expect(await (await GET(new Request(`${base}&repo=a%2Fb&branch=feature`, { headers }), params)).json()).toEqual({ configured: true, branch: "feature", pr: { number: 2 } });
  expect(mocks.remotePr).toHaveBeenCalledWith("a/b", "feature");
});
