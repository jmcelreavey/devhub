import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadOpenRouterUsage } from "./openrouter";

beforeEach(() => vi.stubEnv("OPENROUTER_API_KEY", "fixture-key"));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("shows the remaining balance and usage while credits remain", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ data: { total_credits: 12, total_usage: 2 } }))
    .mockResolvedValueOnce(Response.json({ data: { usage: 2, usage_monthly: 1, limit: null } }));
  vi.stubGlobal("fetch", fetch);

  const usage = await loadOpenRouterUsage();
  expect(usage?.balance?.amount).toBe(10);
  expect(usage?.spend.map(({ label }) => label)).toEqual(["This month", "All time"]);
});

it.each([0, -0.17])("hides a non-positive balance of %s without a second API request", async (balance) => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ data: { total_credits: 10, total_usage: 10 - balance } }));
  vi.stubGlobal("fetch", fetch);

  const usage = await loadOpenRouterUsage();
  expect(usage).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});
