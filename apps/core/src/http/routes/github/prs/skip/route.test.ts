import { beforeEach, expect, it, vi } from "vitest";
import { DELETE, GET, POST } from "./route";

const mocks = vi.hoisted(() => ({
  list: vi.fn(() => []),
  skip: vi.fn().mockResolvedValue(undefined),
  unskip: vi.fn().mockResolvedValue(undefined),
  drop: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("../../../../../lib/github/skipped-prs", () => ({ listSkippedPrs: mocks.list, skipPr: mocks.skip, unskipPr: mocks.unskip }));
vi.mock("../../../../../lib/github/prs", () => ({ dropPrFromGithubPrsCache: mocks.drop, invalidateGithubPrsCache: mocks.invalidate }));

beforeEach(() => vi.clearAllMocks());

it("retains skipped-review validation and cache handling", async () => {
  const base = "http://localhost:1447/api/github/prs/skip";
  expect(await (await GET(new Request(base))).json()).toEqual({ skipped: [] });
  const invalid = await POST(new Request(base, { method: "POST", body: JSON.stringify({ url: "http://example.test" }) }));
  expect(invalid.status).toBe(400);
  expect(mocks.skip).not.toHaveBeenCalled();
  const accepted = await POST(new Request(base, { method: "POST", body: JSON.stringify({ url: " https://example.test/pr " }) }));
  expect(await accepted.json()).toEqual({ ok: true });
  expect(mocks.skip).toHaveBeenCalledWith({ url: "https://example.test/pr", repo: "", number: 0, title: "" });
  expect(mocks.drop).toHaveBeenCalledWith("https://example.test/pr");
  expect((await DELETE(new Request(base, { method: "DELETE" }))).status).toBe(400);
  expect(await (await DELETE(new Request(`${base}?url=https%3A%2F%2Fexample.test%2Fpr`, { method: "DELETE" }))).json()).toEqual({ ok: true });
  expect(mocks.unskip).toHaveBeenCalledWith("https://example.test/pr");
  expect(mocks.invalidate).toHaveBeenCalledOnce();
});
