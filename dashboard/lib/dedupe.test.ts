import { describe, it, expect } from "vitest";
import { dedupeBy } from "./dedupe";

describe("dedupeBy", () => {
  it("keeps the first occurrence of each key", () => {
    const rows = [
      { url: "a", n: 1 },
      { url: "b", n: 2 },
      { url: "a", n: 3 },
      { url: "c", n: 4 },
    ];
    expect(dedupeBy(rows, "url")).toEqual([
      { url: "a", n: 1 },
      { url: "b", n: 2 },
      { url: "c", n: 4 },
    ]);
  });

  it("drops rows where the key is falsy", () => {
    const rows = [
      { url: "", n: 1 },
      { url: undefined as unknown as string, n: 2 },
      { url: "a", n: 3 },
    ];
    expect(dedupeBy(rows, "url")).toEqual([{ url: "a", n: 3 }]);
  });

  it("returns an empty array for an empty input", () => {
    expect(dedupeBy([] as Array<{ url: string }>, "url")).toEqual([]);
  });
});
