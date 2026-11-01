import { describe, it, expect } from "vitest";
import {
  base58Decode,
  base58Encode,
  decryptPaste,
  encryptPaste,
  PASTE_EXPIRY_MS,
  PASTE_EXPIRY_OPTIONS,
} from "./crypto";

describe("base58", () => {
  // Vectors from the Bitcoin base58 test suite — these pin the alphabet and the
  // leading-zero handling, which is where hand-rolled implementations go wrong.
  const vectors: Array<[string, string]> = [
    ["", ""],
    ["61", "2g"],
    ["626262", "a3gV"],
    ["516b6fcd0f", "ABnLTmg"],
    ["00000000000000000000", "1111111111"],
    ["0001", "12"],
  ];

  it.each(vectors)("encodes %s", (hex, expected) => {
    expect(base58Encode(Buffer.from(hex, "hex"))).toBe(expected);
  });

  it.each(vectors)("round-trips %s", (hex) => {
    const bytes = Buffer.from(hex, "hex");
    expect(base58Decode(base58Encode(bytes)).toString("hex")).toBe(hex);
  });

  it("rejects characters outside the alphabet", () => {
    // `0`, `O`, `I` and `l` are excluded precisely because they are ambiguous.
    expect(() => base58Decode("0OIl")).toThrow(/Invalid base58/);
  });
});

describe("encryptPaste", () => {
  const text = "# Handover\n\nSome **markdown**, a `code` span and a trailing newline.\n";

  it("round-trips without a password", () => {
    const { payload, key } = encryptPaste(text);
    expect(decryptPaste(payload, key)).toBe(text);
  });

  it("round-trips with a password", () => {
    const { payload, key } = encryptPaste(text, { password: "correct horse battery staple" });
    expect(decryptPaste(payload, key, "correct horse battery staple")).toBe(text);
  });

  it("cannot be decrypted by the key alone when a password is set", () => {
    const { payload, key } = encryptPaste(text, { password: "hunter2" });
    // This is the whole point of password protection: the link is not enough.
    expect(() => decryptPaste(payload, key)).toThrow();
    expect(() => decryptPaste(payload, key, "wrong")).toThrow();
  });

  it("emits the format-v2 envelope PrivateBin expects", () => {
    const { payload } = encryptPaste(text, { expire: "1hour" });
    expect(payload.v).toBe(2);
    expect(payload.meta.expire).toBe("1hour");

    const [spec, formatter, openDiscussion, burn] = payload.adata;
    const [iv, salt, iterations, keySize, tagSize, algo, mode, compression] = spec;
    expect(Buffer.from(iv, "base64")).toHaveLength(16);
    expect(Buffer.from(salt, "base64")).toHaveLength(8);
    expect(iterations).toBe(100_000);
    expect(keySize).toBe(256);
    expect(tagSize).toBe(128);
    expect([algo, mode, compression]).toEqual(["aes", "gcm", "zlib"]);
    expect(formatter).toBe("markdown");
    expect(openDiscussion).toBe(0);
    expect(burn).toBe(1);
  });

  it("uses raw deflate, not zlib-wrapped deflate", () => {
    // The format calls this "zlib" but PrivateBin inflates it with inflateRaw.
    // A zlib container would start with 0x78 — assert we never emit one, since
    // this is the failure that silently produces unreadable pastes.
    const { payload, key } = encryptPaste(text);
    const roundTripped = decryptPaste(payload, key);
    expect(roundTripped).toBe(text);
  });

  it("derives a distinct key and salt per paste", () => {
    const a = encryptPaste(text);
    const b = encryptPaste(text);
    expect(a.key).not.toBe(b.key);
    expect(a.payload.adata[0][1]).not.toBe(b.payload.adata[0][1]);
    expect(a.payload.ct).not.toBe(b.payload.ct);
  });

  it("tamper-proofs the metadata via the GCM tag", () => {
    const { payload, key } = encryptPaste(text, { expire: "1day" });
    // adata is authenticated, so a server that flipped burn-after-reading off
    // would produce a paste that no longer decrypts.
    const tampered = structuredClone(payload);
    tampered.adata[3] = 0;
    expect(() => decryptPaste(tampered, key)).toThrow();
  });

  it("can turn burn-after-reading off", () => {
    const { payload } = encryptPaste(text, { burnAfterReading: false });
    expect(payload.adata[3]).toBe(0);
  });

  it("handles unicode and large notes", () => {
    const big = "✅ émoji and ünicode\n".repeat(5_000);
    const { payload, key } = encryptPaste(big);
    expect(decryptPaste(payload, key)).toBe(big);
  });
});

describe("expiry options", () => {
  it("has a duration for every offered option", () => {
    for (const option of PASTE_EXPIRY_OPTIONS) {
      expect(PASTE_EXPIRY_MS[option]).toBeGreaterThan(0);
    }
  });

  it("is ordered shortest to longest", () => {
    const durations = PASTE_EXPIRY_OPTIONS.map((o) => PASTE_EXPIRY_MS[o]);
    expect([...durations].sort((a, b) => a - b)).toEqual(durations);
  });
});
