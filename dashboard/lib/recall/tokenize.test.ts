import { describe, expect, it } from "vitest";
import { estimateTokens, termFrequency, tokenize } from "./tokenize";

describe("tokenize", () => {
  it("drops stop words by default", () => {
    expect(tokenize("the cache and the purge")).toEqual(["cach", "purg"]);
  });

  it("keeps them when asked", () => {
    expect(tokenize("the cache", { keepStopWords: true })).toContain("the");
  });

  it("collapses inflections of the same word onto one token", () => {
    // The point of stemming here: all four spellings have to reach the same
    // token or BM25 scores them as unrelated terms.
    const base = tokenize("purge");
    expect(tokenize("purges")).toEqual(base);
    expect(tokenize("purged")).toEqual(base);
    expect(tokenize("purging")).toEqual(base);
    expect(tokenize("caches")).toEqual(tokenize("cache"));
    expect(tokenize("notes")).toEqual(tokenize("note"));
  });

  it("does not attempt derivational morphology", () => {
    // Documented limitation — suffix rules that try this destroy precision.
    expect(tokenize("deployment")).not.toEqual(tokenize("deploy"));
  });

  it("refuses to strip a word down to nothing", () => {
    expect(tokenize("has")).toEqual([]); // stop word
    expect(tokenize("used")).toEqual(["used"]); // "us" would be meaningless
    expect(tokenize("cat")).toEqual(["cat"]);
  });

  it("splits identifiers while keeping the original", () => {
    const tokens = tokenize("getUserById");
    expect(tokens).toContain("getuserbyid");
    expect(tokens).toContain("user");
    expect(tokens).toContain("get");
    // "by" is a stop word, so identifier splitting does not smuggle it back in.
    expect(tokens).not.toContain("by");
  });

  it("splits snake and kebab case", () => {
    const tokens = tokenize("cache_purge_handler");
    expect(tokens).toEqual(expect.arrayContaining(tokenize("cache")));
    expect(tokens).toContain("handler");
    expect(tokenize("cache-purge-handler")).toContain("handler");
  });

  it("skips stemming in raw mode", () => {
    expect(tokenize("purging", { raw: true })).toContain("purging");
  });

  it("returns nothing for punctuation-only input", () => {
    expect(tokenize("!!! ??? ...")).toEqual([]);
    expect(tokenize("")).toEqual([]);
  });
});

describe("termFrequency", () => {
  it("counts repeats", () => {
    expect(termFrequency(["a", "b", "a"])).toEqual(new Map([["a", 2], ["b", 1]]));
  });

  it("handles an empty list", () => {
    expect(termFrequency([]).size).toBe(0);
  });
});

describe("estimateTokens", () => {
  it("approximates chars/4", () => {
    expect(estimateTokens("x".repeat(400))).toBe(100);
  });

  it("never returns zero, so budget packing can't loop forever", () => {
    expect(estimateTokens("")).toBe(1);
  });
});
