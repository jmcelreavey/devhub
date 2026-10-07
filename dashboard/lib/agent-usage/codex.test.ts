import { describe, expect, it } from "vitest";
import {
  CODEX_MODEL_PRICES,
  applyRemoteCodexPrices,
  localDayKey,
  pricesFromModelsDevOpenAi,
  resetCodexModelPricesForTests,
  responseCostUsd,
  tallyRollout,
} from "./codex";

const usage = (input: number, output: number, cached = 0, write = 0) => ({ input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: write, output_tokens: output });
const turn = (model: string) => JSON.stringify({ timestamp: "2026-09-10T10:00:00.000Z", type: "turn_context", payload: { model } });
const record = (ts: string, u: ReturnType<typeof usage>) => JSON.stringify({ timestamp: ts, type: "token_usage_record", payload: { usage: u } });
const count = (ts: string, total: ReturnType<typeof usage>, last: ReturnType<typeof usage>) =>
  JSON.stringify({ timestamp: ts, type: "event_msg", payload: { type: "token_count", info: { total_token_usage: total, last_token_usage: last } } });

describe("responseCostUsd", () => {
  it("prices cached and cache-write input separately from fresh input", () => {
    const price = CODEX_MODEL_PRICES["gpt-5.6-sol"];
    // 1M input of which 500k cached and 200k written: 300k fresh.
    expect(responseCostUsd(price, usage(1_000_000, 100_000, 500_000, 200_000))).toBeCloseTo(0.3 * 4 + 0.5 * 0.4 + 0.2 * 5 + 0.1 * 20);
  });

  it("falls back to the input price when no cache-write price is listed", () => {
    expect(responseCostUsd(CODEX_MODEL_PRICES["gpt-5.5"], usage(1_000_000, 0, 0, 1_000_000))).toBeCloseTo(5);
  });
});

describe("tallyRollout", () => {
  const day = localDayKey(new Date("2026-09-10T12:00:00.000Z"));

  it("differences running totals and ignores repeated events", async () => {
    const days = await tallyRollout([
      turn("gpt-5.6-sol"),
      count("2026-09-10T12:00:00.000Z", usage(1000, 10), usage(1000, 10)),
      count("2026-09-10T12:00:01.000Z", usage(1000, 10), usage(1000, 10)),
      count("2026-09-10T12:01:00.000Z", usage(3000, 30), usage(2000, 20)),
    ]);
    expect(days.get(day)?.tokens).toBe(3030);
  });

  it("uses last usage for the first total so a resumed thread isn't double-counted", async () => {
    const days = await tallyRollout([turn("gpt-5.6-sol"), count("2026-09-10T12:00:00.000Z", usage(900_000, 9000), usage(1000, 10))]);
    expect(days.get(day)?.tokens).toBe(1010);
  });

  it("prefers per-response records, which include compaction calls", async () => {
    const days = await tallyRollout([
      turn("gpt-5.6-sol"),
      record("2026-09-10T12:00:00.000Z", usage(1000, 10)),
      count("2026-09-10T12:00:00.000Z", usage(1000, 10), usage(1000, 10)),
      record("2026-09-10T12:05:00.000Z", usage(250_000, 5000)),
    ]);
    expect(days.get(day)?.tokens).toBe(256_010);
  });

  it("reports tokens from models it has no price for instead of guessing", async () => {
    const days = await tallyRollout([turn("gpt-mystery"), record("2026-09-10T12:00:00.000Z", usage(1000, 10))]);
    expect(days.get(day)).toEqual({ costUsd: 0, tokens: 1010, unpricedTokens: { "gpt-mystery": 1010 } });
  });
});


describe("CODEX_MODEL_PRICES gpt-6", () => {
  it("prices gpt-6-sol and gpt-6-luna at the published short-context rates", () => {
    expect(CODEX_MODEL_PRICES["gpt-6-sol"]).toEqual({ input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 10 });
    expect(CODEX_MODEL_PRICES["gpt-6-luna"]).toEqual({ input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5 });
  });
});

describe("pricesFromModelsDevOpenAi", () => {
  it("reads OpenAI cost rows into ModelPrice and seeds win on apply", () => {
    const remote = pricesFromModelsDevOpenAi({
      openai: {
        models: {
          "gpt-mystery": { cost: { input: 1, output: 2, cache_read: 0.1, cache_write: 1.25 } },
          // Deliberately wrong — hand-checked seed must win.
          "gpt-6-sol": { cost: { input: 999, output: 999, cache_read: 9, cache_write: 9 } },
        },
      },
    });
    expect(remote["gpt-mystery"]).toEqual({ input: 1, cachedInput: 0.1, cacheWrite: 1.25, output: 2 });
    resetCodexModelPricesForTests();
    applyRemoteCodexPrices(remote);
    // Seed still wins for gpt-6-sol; mystery is available for tallying.
    expect(CODEX_MODEL_PRICES["gpt-6-sol"].input).toBe(2);
  });
});

describe("tallyRollout with gpt-6-sol", () => {
  const day = localDayKey(new Date("2026-09-10T12:00:00.000Z"));

  it("prices gpt-6-sol instead of reporting it as unpriced", async () => {
    resetCodexModelPricesForTests();
    const days = await tallyRollout([turn("gpt-6-sol"), record("2026-09-10T12:00:00.000Z", usage(1_000_000, 100_000))]);
    expect(days.get(day)?.unpricedTokens).toEqual({});
    expect(days.get(day)?.costUsd).toBeCloseTo(2 + 1); // 1M input @ $2 + 100k output @ $10
  });
});
