import { describe, expect, it } from "vitest";
import { cosine, dequantise, hashedTrigramEmbedder, quantise, trigrams } from "./embed";

const embedder = hashedTrigramEmbedder();
const sim = (a: string, b: string) => cosine(embedder.embed(a), embedder.embed(b));

describe("trigrams", () => {
  it("pads so word boundaries carry information", () => {
    expect(trigrams("ab")).toEqual([" ab", "ab "]);
  });

  it("returns nothing for input too short to form a gram", () => {
    expect(trigrams("")).toEqual([]);
    expect(trigrams("!!!")).toEqual([]);
  });
});

describe("hashedTrigramEmbedder", () => {
  it("is deterministic — the property the whole index depends on", () => {
    expect([...embedder.embed("cache purge")]).toEqual([...embedder.embed("cache purge")]);
  });

  it("produces unit vectors, so dot product is cosine", () => {
    const vec = embedder.embed("some reasonably long piece of text about caching");
    const magnitude = Math.sqrt([...vec].reduce((sum, n) => sum + n * n, 0));
    expect(magnitude).toBeCloseTo(1, 5);
  });

  it("scores morphological variants above unrelated text", () => {
    // This is the specific gap over BM25: same concept, different suffix.
    expect(sim("cache purging", "cache purge")).toBeGreaterThan(
      sim("cache purging", "calendar invitation"),
    );
  });

  it("scores reordered phrases as similar", () => {
    expect(sim("cache invalidation", "invalidation cache")).toBeGreaterThan(0.8);
  });

  it("is honest about its limits — no synonym knowledge", () => {
    // Documented, not aspirational: this is a morphological space, not a
    // semantic one. If this assertion ever fails, a real embedder was wired in
    // and the docstring in embed.ts needs updating.
    expect(sim("lorry", "truck")).toBeLessThan(0.3);
  });

  it("returns a zero vector for empty input rather than NaN", () => {
    const vec = embedder.embed("");
    expect([...vec].every((n) => n === 0)).toBe(true);
    expect(Number.isNaN(cosine(vec, vec))).toBe(false);
  });
});

describe("quantise / dequantise", () => {
  it("round-trips within int8 precision", () => {
    const original = embedder.embed("cache invalidation strategy");
    const restored = dequantise(quantise(original));
    for (let i = 0; i < original.length; i++) {
      expect(Math.abs(original[i] - restored[i])).toBeLessThan(0.01);
    }
  });

  it("preserves ranking, which is all the fusion needs", () => {
    const query = embedder.embed("cache purge");
    const near = quantise(embedder.embed("purging the cache"));
    const far = quantise(embedder.embed("weekly calendar sync"));
    expect(cosine(query, dequantise(near))).toBeGreaterThan(cosine(query, dequantise(far)));
  });

  it("clamps rather than overflowing int8", () => {
    const extreme = new Float32Array([5, -5, 0]);
    expect(quantise(extreme)).toEqual([127, -127, 0]);
  });
});
