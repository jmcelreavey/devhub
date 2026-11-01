import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ authenticated: vi.fn(), organizations: vi.fn(), search: vi.fn() }));
vi.mock("../../../../../lib/gh-exec", () => ({ isGithubCliAuthenticated: mocks.authenticated, mapGithubCliError: () => ({ error: "failed", status: 502 }) }));
vi.mock("../../../../../lib/integrations/screen-data", () => ({ githubScreen: { organizations: mocks.organizations, search: mocks.search } }));
vi.mock("../../../../../lib/github/prs", () => ({ rowFromSearchItem: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

it("keeps empty, unauthenticated and bounded PR searches unchanged", async () => {
  const base = "http://localhost:1447/api/github/prs/search";
  expect(await (await GET(new Request(`${base}?q=%20`))).json()).toEqual({ configured: true, query: "", ghQuery: "", results: [] });
  expect(mocks.authenticated).not.toHaveBeenCalled();
  mocks.authenticated.mockResolvedValueOnce(false);
  const longQuery = "a".repeat(220);
  const result = await (await GET(new Request(`${base}?q=${longQuery}`))).json();
  expect(result).toEqual({ configured: false, query: "a".repeat(200), ghQuery: "", results: [] });
  expect(mocks.search).not.toHaveBeenCalled();
});
