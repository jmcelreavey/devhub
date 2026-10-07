import { afterEach, expect, it, vi } from "vitest";
vi.mock("./opencode-auth", () => ({ findApiKey: vi.fn(async () => "test-key") }));
import { loadZaiUsage } from "./zai";
afterEach(() => vi.unstubAllGlobals());
it.each([{}, { data: undefined }, { data: null }, { data: { limits: "wrong" } }])("handles missing quota data without surfacing Zod internals: %j", async (body) => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(body)));
  await expect(loadZaiUsage()).rejects.toThrow("Couldn't load z.ai usage");
});
it("reads a valid quota response", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: { limits: [{ type: "TOKENS_LIMIT", percentage: 25 }] } })));
  expect(await loadZaiUsage()).toMatchObject({ status: "ok", meters: [{ label: "5-hour prompts", percent: 25 }] });
});
