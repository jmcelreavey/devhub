import { describe, it, expect } from "vitest";
import { isCurrentNoteSaveGeneration, nextNoteSaveGeneration } from "./note-save-generation";

describe("note-save-generation", () => {
  it("bumps generation and rejects stale scheduled saves", () => {
    let generation = 0;
    generation = nextNoteSaveGeneration(generation);
    const scheduled = generation;
    expect(isCurrentNoteSaveGeneration(scheduled, generation)).toBe(true);

    generation = nextNoteSaveGeneration(generation);
    expect(isCurrentNoteSaveGeneration(scheduled, generation)).toBe(false);
  });
});
