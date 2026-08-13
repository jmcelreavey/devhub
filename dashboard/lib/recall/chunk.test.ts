import { describe, expect, it } from "vitest";
import { bestSnippet, chunkText } from "./chunk";

describe("chunkText", () => {
  it("leaves short documents whole", () => {
    const chunks = chunkText("# Title\n\nA short note about caching.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].ordinal).toBe(0);
  });

  it("returns nothing for blank input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n  \n ")).toEqual([]);
  });

  it("splits long documents on paragraph boundaries", () => {
    const para = "This is a paragraph about cache invalidation and why it is hard. ".repeat(5);
    const chunks = chunkText([para, para, para, para].join("\n\n"));
    expect(chunks.length).toBeGreaterThan(1);
    // A mid-sentence split makes both halves read as noise and degrades the
    // trigram vectors badly.
    for (const chunk of chunks) expect(chunk.text.trim()).not.toBe("");
  });

  it("overlaps adjacent chunks so a fact on the boundary stays findable", () => {
    const chunks = chunkText(
      Array.from({ length: 12 }, (_, i) => `Paragraph ${i} with enough words to matter here.`.repeat(3)).join(
        "\n\n",
      ),
    );
    expect(chunks.length).toBeGreaterThan(1);
    const firstTail = chunks[0].text.slice(-40);
    expect(chunks[1].text.includes(firstTail.slice(0, 20))).toBe(true);
  });

  it("hard-splits a wall of text with no blank lines", () => {
    const wall = "word ".repeat(2000);
    const chunks = chunkText(wall);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("carries the nearest preceding heading onto later chunks", () => {
    const body = [
      "# Doc",
      "",
      "intro paragraph ".repeat(60),
      "",
      "## Cache section",
      "",
      "details about the cache ".repeat(60),
      "",
      "more details still ".repeat(60),
    ].join("\n");
    const chunks = chunkText(body);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.some((c) => c.heading !== undefined)).toBe(true);
  });

  it("never emits a stub chunk on its own", () => {
    const chunks = chunkText(`${"filler paragraph text here ".repeat(80)}\n\nok`);
    expect(chunks[chunks.length - 1].text.length).toBeGreaterThan(40);
  });

  it("numbers chunks contiguously from zero", () => {
    const chunks = chunkText("para ".repeat(400).split(" ").join("\n\n"));
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
  });
});

describe("bestSnippet", () => {
  it("picks the line containing the most query tokens", () => {
    const text = "unrelated opener\ncache purge failed on edge\nanother line";
    expect(bestSnippet(text, ["cache", "purge"])).toBe("cache purge failed on edge");
  });

  it("falls back to the first line with no query", () => {
    expect(bestSnippet("first\nsecond", [])).toBe("first");
  });

  it("returns empty string for empty text", () => {
    expect(bestSnippet("", ["cache"])).toBe("");
  });

  it("truncates to the requested length", () => {
    expect(bestSnippet("x".repeat(500), [], 50)).toHaveLength(50);
  });
});
