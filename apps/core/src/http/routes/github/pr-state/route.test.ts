import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ state: vi.fn() }));
vi.mock("../../../../lib/integrations/screen-data", () => ({ githubScreen: { state: mocks.state } }));
beforeEach(() => vi.resetAllMocks());

it("authenticates and validates PR state requests without changing errors", async () => {
  const base = "http://localhost:1447/api/github/pr-state";
  const headers = { origin: "http://localhost:1447", host: "localhost:1447" };
  expect([401, 403]).toContain((await GET(new Request(`${base}?repo=a%2Fb&number=1`))).status);
  expect((await GET(new Request(`${base}?repo=..%2Fb&number=1`, { headers }))).status).toBe(400);
  expect((await GET(new Request(`${base}?repo=a%2Fb&number=0`, { headers }))).status).toBe(400);
  expect(mocks.state).not.toHaveBeenCalled();
  mocks.state.mockResolvedValueOnce({ state: "OPEN" });
  const good = await GET(new Request(`${base}?repo=a%2Fb&number=2`, { headers }));
  expect(await good.json()).toEqual({ pr: { state: "OPEN" } });
  expect(mocks.state).toHaveBeenCalledWith("a/b", 2);
  mocks.state.mockRejectedValueOnce(Object.assign(new Error("failed"), { stderr: "first line\nsecond line" }));
  const failure = await GET(new Request(`${base}?repo=a%2Fb&number=2`, { headers }));
  expect(failure.status).toBe(502);
  expect(await failure.json()).toEqual({ error: "gh pr view failed: first line" });
});
