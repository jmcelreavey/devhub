import { describe, expect, it } from "vitest";
import { semanticSearchNotes } from "./semantic.ts";
import { lexicalSearchNotes } from "./lexical.ts";

describe("semantic alias", () => {
  it("re-exports lexicalSearchNotes", () => {
    expect(semanticSearchNotes).toBe(lexicalSearchNotes);
  });
});
