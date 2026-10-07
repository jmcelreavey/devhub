import { afterEach, expect, it, vi } from "vitest";
vi.mock("./opencode-auth", () => ({ findApiKey: vi.fn(async () => "test-key") }));
// The aggregate test must not read this machine's real sign-ins.
vi.mock("./claude", () => ({ loadClaudeUsage: async () => null }));
vi.mock("./codex", () => ({ loadCodexUsage: async () => null }));
vi.mock("./cursor", () => ({ loadCursorUsage: async () => null }));
vi.mock("./copilot", () => ({ loadCopilotUsage: async () => null }));
vi.mock("./openrouter", () => ({ loadOpenRouterUsage: async () => null }));
import { loadZaiUsage } from "./zai";
import { loadAgentUsage } from "./index";
import { UsageLoadError } from "./load-error";
afterEach(() => vi.unstubAllGlobals());
it.each([{}, { data: undefined }, { data: null }, { data: { limits: "wrong" } }])("handles missing quota data without surfacing Zod internals: %j", async (body) => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(body)));
  await expect(loadZaiUsage()).rejects.toThrow("Couldn't load z.ai usage");
});
it("reads a valid quota response", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: { limits: [{ type: "TOKENS_LIMIT", percentage: 25 }] } })));
  expect(await loadZaiUsage()).toMatchObject({ status: "ok", meters: [{ label: "5-hour prompts", percent: 25 }] });
});
it.each([
  [() => Response.json({}, { status: 401 }), /rejected the API key \(HTTP 401\)/],
  [() => Response.json({}, { status: 503 }), /answered HTTP 503/],
  [() => Response.json({}), /unexpected shape/],
])("explains why z.ai usage failed in a short reason", async (respond, reason) => {
  vi.stubGlobal("fetch", vi.fn(async () => respond()));
  const error = await loadZaiUsage().catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(UsageLoadError);
  expect((error as UsageLoadError).reason).toMatch(reason);
});
it("reports a network failure as such, without the raw error", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed: ECONNRESET secret-host"); }));
  const error = await loadZaiUsage().catch((caught: unknown) => caught) as UsageLoadError;
  expect(error.reason).toMatch(/network error or timeout/);
  expect(error.reason + error.message).not.toContain("secret-host");
});
it("shows the reason on the z.ai card, leaving other providers alone", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({}, { status: 401 })));
  const zai = (await loadAgentUsage("zai")).find((provider) => provider.id === "zai");
  expect(zai).toMatchObject({ status: "error", summary: "Couldn't load z.ai usage", reason: expect.stringContaining("HTTP 401") });
});
