import { describe, expect, it } from "vitest";
import { Bm25Index } from "./bm25";
import { tokenize } from "./tokenize";

const doc = (id: string, text: string) => ({ id, tokens: tokenize(text) });

describe("Bm25Index", () => {
  it("ranks the document that is actually about the query first", () => {
    const index = new Bm25Index([
      doc("a", "cache invalidation strategy for the CDN edge"),
      doc("b", "the standup script formats markdown"),
      doc("c", "notes on cache warming"),
    ]);
    expect(index.search("cache invalidation")[0].id).toBe("a");
  });

  it("normalises for document length — the fix TF-IDF was missing", () => {
    // Same single mention of the term; one buried in a wall of unrelated text.
    const short = "the cache purge endpoint";
    const long = `the cache purge endpoint ${"unrelated filler prose ".repeat(200)}`;
    const index = new Bm25Index([doc("short", short), doc("long", long)]);
    const results = index.search("cache purge");
    expect(results[0].id).toBe("short");
  });

  it("never scores a matching document below a non-matching one", () => {
    // A term in most of the corpus produces negative IDF without the floor,
    // which inverts the ranking.
    const docs = Array.from({ length: 10 }, (_, i) => doc(`d${i}`, "cache cache cache"));
    docs.push(doc("none", "totally different words here"));
    const index = new Bm25Index(docs);
    const results = index.search("cache");
    expect(results.every((r) => r.score > 0)).toBe(true);
    expect(results.map((r) => r.id)).not.toContain("none");
  });

  it("returns nothing for a query of only stop words", () => {
    const index = new Bm25Index([doc("a", "cache invalidation")]);
    expect(index.search("the and of")).toEqual([]);
  });

  it("handles an empty index without throwing", () => {
    expect(new Bm25Index().search("anything")).toEqual([]);
  });

  it("is deterministic across equal scores", () => {
    const index = new Bm25Index([doc("b", "cache"), doc("a", "cache")]);
    const first = index.search("cache").map((r) => r.id);
    const second = index.search("cache").map((r) => r.id);
    expect(first).toEqual(second);
    expect(first[0]).toBe("a");
  });
});
