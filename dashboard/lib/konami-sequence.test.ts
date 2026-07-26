import { describe, expect, it } from "vitest";
import { advanceKonami, isTypingTarget, KONAMI_SEQUENCE } from "./konami-sequence";

/** Drive the matcher over a list of keys; returns null once the sequence lands. */
function run(keys: readonly string[]): number | null {
  let idx: number | null = 0;
  for (const key of keys) {
    if (idx === null) idx = 0;
    idx = advanceKonami(idx, key);
  }
  return idx;
}

describe("advanceKonami", () => {
  it("completes on the full sequence", () => {
    expect(run(KONAMI_SEQUENCE)).toBeNull();
  });

  it("is case-insensitive for the letter keys", () => {
    expect(run([...KONAMI_SEQUENCE.slice(0, 8), "B", "A"])).toBeNull();
  });

  it("does not complete on a partial sequence", () => {
    expect(run(KONAMI_SEQUENCE.slice(0, -1))).toBe(KONAMI_SEQUENCE.length - 1);
  });

  it("resets on a wrong key", () => {
    expect(advanceKonami(4, "x")).toBe(0);
  });

  it("treats a wrong key that is also the first key as a fresh start", () => {
    expect(advanceKonami(4, "ArrowUp")).toBe(1);
  });

  it("recovers mid-run and still completes", () => {
    expect(run(["ArrowUp", "x", ...KONAMI_SEQUENCE])).toBeNull();
  });
});

describe("isTypingTarget", () => {
  it.each(["INPUT", "TEXTAREA", "SELECT"])("is true for <%s>", (tag) => {
    expect(isTypingTarget({ tagName: tag } as unknown as EventTarget)).toBe(true);
  });

  it("is true for contenteditable", () => {
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget)).toBe(true);
  });

  it("is false for a plain element and for null", () => {
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: false } as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
