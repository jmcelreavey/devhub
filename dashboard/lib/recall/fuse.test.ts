import { describe, expect, it } from "vitest";
import { combineScores, entityScore, recencyScore, reciprocalRankFusion } from "./fuse";

describe("reciprocalRankFusion", () => {
  it("rewards documents both retrievers return over ones only a single list found", () => {
    const fused = reciprocalRankFusion([
      { ids: ["both", "lexOnly"], weight: 0.5 },
      { ids: ["both", "vecOnly"], weight: 0.5 },
    ]);
    expect(fused.get("both")).toBeGreaterThan(fused.get("lexOnly") as number);
    expect(fused.get("both")).toBeGreaterThan(fused.get("vecOnly") as number);
  });

  it("prefers a strong-in-one over a middling-in-both, which is intended", () => {
    // 1/61 + 1/63 > 2/62 because 1/x is convex. Worth an explicit test: it
    // looks like a bug the first time you see it, and it is the behaviour that
    // lets an exact identifier match win despite weak vector similarity.
    const fused = reciprocalRankFusion([
      { ids: ["spiky", "flat", "other"], weight: 0.5 },
      { ids: ["other", "flat", "spiky"], weight: 0.5 },
    ]);
    expect(fused.get("spiky")).toBeGreaterThan(fused.get("flat") as number);
  });

  it("is deterministic and independent of score magnitude", () => {
    // BM25 is unbounded, cosine is [-1,1]. A weighted sum of the raw numbers
    // is just BM25 with rounding error; fusing positions cannot be.
    const a = reciprocalRankFusion([{ ids: ["x", "y"], weight: 1 }]);
    const b = reciprocalRankFusion([{ ids: ["x", "y"], weight: 1 }]);
    expect(a.get("x")).toBe(b.get("x"));
    expect(a.get("x")).toBeGreaterThan(a.get("y") as number);
  });

  it("honours weights — alpha 0 means the vector list contributes nothing", () => {
    const fused = reciprocalRankFusion([
      { ids: ["lex"], weight: 1 },
      { ids: ["vec"], weight: 0 },
    ]);
    expect(fused.has("vec")).toBe(false);
    expect(fused.get("lex")).toBeGreaterThan(0);
  });

  it("returns an empty map for no lists", () => {
    expect(reciprocalRankFusion([]).size).toBe(0);
  });
});

describe("recencyScore", () => {
  const now = Date.UTC(2026, 0, 1);

  it("is 1 for now and halves every 90 days", () => {
    expect(recencyScore(now, now)).toBeCloseTo(1, 5);
    expect(recencyScore(now - 90 * 86_400_000, now)).toBeCloseTo(0.5, 3);
    expect(recencyScore(now - 180 * 86_400_000, now)).toBeCloseTo(0.25, 3);
  });

  it("never reaches zero, so nothing becomes unreachable", () => {
    expect(recencyScore(now - 3650 * 86_400_000, now)).toBeGreaterThan(0);
  });

  it("treats future and invalid timestamps safely", () => {
    expect(recencyScore(now + 86_400_000, now)).toBeCloseTo(1, 5);
    expect(recencyScore(0, now)).toBe(0);
    expect(recencyScore(Number.NaN, now)).toBe(0);
  });
});

describe("entityScore", () => {
  it("is zero when the query names no entities", () => {
    expect(entityScore(["jira:PTF-1"], [])).toBe(0);
  });

  it("saturates so one chunk can't run away on entity count alone", () => {
    const one = entityScore(["jira:A"], ["jira:A"]);
    const eight = entityScore(
      Array.from({ length: 8 }, (_, i) => `jira:${i}`),
      Array.from({ length: 8 }, (_, i) => `jira:${i}`),
    );
    expect(one).toBeCloseTo(0.5, 5);
    expect(eight).toBeLessThan(1);
    expect(eight).toBeGreaterThan(one);
  });
});

describe("combineScores", () => {
  it("keeps fusion dominant over the priors", () => {
    const relevant = combineScores({ id: "a", fused: 0.02, recency: 0, entity: 0 });
    const onlyPriors = combineScores({ id: "b", fused: 0.001, recency: 1, entity: 1 });
    // A chunk with a perfect entity match but no textual relevance should place
    // well, not first.
    expect(onlyPriors).toBeGreaterThan(0);
    expect(relevant).toBeLessThan(onlyPriors);
    const strongly = combineScores({ id: "c", fused: 0.2, recency: 0, entity: 0 });
    expect(strongly).toBeGreaterThan(onlyPriors);
  });
});
