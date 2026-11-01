import { describe, it, expect } from "vitest";
import {
  PASSPHRASE_WORDS,
  WORDLIST_SIZE,
  WORDS,
  generatePassphrase,
  passphraseEntropyBits,
} from "./passphrase";

describe("wordlist", () => {
  it("has no duplicates", () => {
    // A duplicate silently costs entropy and is invisible by inspection.
    expect(new Set(WORDS).size).toBe(WORDS.length);
  });

  it("is large enough to be worth calling a wordlist", () => {
    expect(WORDLIST_SIZE).toBeGreaterThanOrEqual(256);
  });

  it("contains only lowercase letters", () => {
    // Anything else has to survive being retyped from a phone call.
    for (const word of WORDS) expect(word).toMatch(/^[a-z]{3,12}$/);
  });
});

describe("generatePassphrase", () => {
  it("produces the configured number of lowercase words", () => {
    const phrase = generatePassphrase();
    const words = phrase.split(" ");
    expect(words).toHaveLength(PASSPHRASE_WORDS);
    for (const word of words) expect(word).toMatch(/^[a-z]+$/);
  });

  it("does not repeat itself", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generatePassphrase()));
    expect(seen.size).toBe(200);
  });

  it("honours an explicit word count", () => {
    expect(generatePassphrase(3).split(" ")).toHaveLength(3);
  });
});

describe("passphraseEntropyBits", () => {
  it("clears 48 bits at the configured defaults", () => {
    // Guards against someone shortening the phrase or trimming the list. 48 is
    // the floor for a second factor that also requires the paste URL — see the
    // reasoning on PASSPHRASE_WORDS before lowering it.
    expect(passphraseEntropyBits()).toBeGreaterThan(48);
  });

  it("scales with word count", () => {
    expect(passphraseEntropyBits(6, 256)).toBeCloseTo(48, 5);
    expect(passphraseEntropyBits(3, 256)).toBeCloseTo(24, 5);
  });
});
