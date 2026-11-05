import fs from "node:fs/promises";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadExperientialUsage } from "./experiential";

beforeEach(() => vi.stubEnv("EXPLABS_API_KEY", "fixture-key"));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("omits an unconfigured provider without calling the gateway", async () => {
  vi.stubEnv("EXPLABS_API_KEY", "");
  vi.spyOn(fs, "readFile").mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect(await loadExperientialUsage()).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it("reads usage separately from funded credits and preserves an overdrawn balance", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: { total_credits: 7, total_usage: 8.25 } })));

  const usage = await loadExperientialUsage();
  expect(usage?.balance?.amount).toBe(-1.25);
  expect(usage?.spend).toEqual([{ label: "Total usage", amount: 8.25, currency: "USD", source: "billed" }]);
});

it.each([
  { data: { total_credits: 7 } },
  { data: { total_credits: "7", total_usage: "0.02" } },
  { data: { total_credits: 7, total_usage: -1 } },
])("rejects malformed credit data instead of showing a misleading zero", async (data) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(data)));
  await expect(loadExperientialUsage()).rejects.toThrow("Couldn't read Experiential Labs credits.");
});

it("keeps vendor error bodies and credentials out of reported failures", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("fixture-key: sensitive vendor response", { status: 401 })));
  await expect(loadExperientialUsage()).rejects.toMatchObject({
    message: "Experiential Labs rejected the key (HTTP 401).",
    reason: "Check EXPLABS_API_KEY or the saved Experiential Labs key file.",
  });
});
