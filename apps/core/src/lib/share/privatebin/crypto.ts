import crypto from "node:crypto";
import zlib from "node:zlib";

/**
 * PrivateBin "format version 2" client-side encryption (instances >= 1.3).
 *
 * The server never sees plaintext: we encrypt here, and the key travels in the
 * URL fragment, which browsers do not send to the server. See
 * https://github.com/PrivateBin/PrivateBin/wiki/Encryption-format
 *
 * Hand-rolled rather than pulled from npm because the whole format is ~100
 * lines of stdlib crypto, and the available packages are thin wrappers with
 * unclear password support.
 */

const KDF_ITERATIONS = 100_000;
const KDF_KEYSIZE_BITS = 256;
const KDF_SALT_BYTES = 8;
const CIPHER_IV_BYTES = 16;
const CIPHER_TAG_BITS = 128;
const PASTE_KEY_BYTES = 32;

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Base58 (Bitcoin alphabet) — how PrivateBin encodes the key in the fragment.
 *
 * Leading zero bytes carry no value in the big-integer sense but are still
 * significant, so they are counted off first and re-emitted as the alphabet's
 * zero digit. A 32-byte random key starts with a zero byte about once in 256,
 * so this path is reached in normal use, not just in tests.
 */
export function base58Encode(bytes: Buffer): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;

  const digits: number[] = [];
  for (const byte of bytes.subarray(zeros)) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  return (
    BASE58_ALPHABET[0].repeat(zeros) +
    digits
      .reverse()
      .map((digit) => BASE58_ALPHABET[digit])
      .join("")
  );
}

/** Server-enforced lifetime. Keys must match the instance's configured options. */
export const PASTE_EXPIRY_OPTIONS = [
  "5min",
  "10min",
  "1hour",
  "1day",
  "1week",
  "1month",
] as const;

export type PasteExpiry = (typeof PASTE_EXPIRY_OPTIONS)[number];

/** Milliseconds each expiry key corresponds to, for local bookkeeping only. */
export const PASTE_EXPIRY_MS: Record<PasteExpiry, number> = {
  "5min": 5 * 60_000,
  "10min": 10 * 60_000,
  "1hour": 60 * 60_000,
  "1day": 24 * 60 * 60_000,
  "1week": 7 * 24 * 60 * 60_000,
  "1month": 30 * 24 * 60 * 60_000,
};

/** The wire format PrivateBin's API accepts on create. */
export interface PastePayload {
  v: 2;
  adata: PasteAdata;
  ct: string;
  meta: { expire: PasteExpiry };
}

type PasteAdata = [
  [string, string, number, number, number, "aes", "gcm", "zlib"],
  string,
  0 | 1,
  0 | 1,
];

export interface EncryptOptions {
  /** Empty string means "key only" — the URL alone can then decrypt. */
  password?: string;
  expire?: PasteExpiry;
  burnAfterReading?: boolean;
  formatter?: "markdown" | "plaintext" | "syntaxhighlighting";
}

export interface EncryptedPaste {
  payload: PastePayload;
  /** base58 of the raw key — belongs in the URL fragment, never in a request. */
  key: string;
}

/**
 * Encrypt paste text into the payload PrivateBin stores plus the key that
 * decrypts it.
 *
 * Two details are easy to get wrong and produce a paste that PrivateBin's own
 * JavaScript cannot read:
 *
 *  - The format calls its compression "zlib" but it is *raw* deflate.
 *    `zlib.deflateSync` adds a header that PrivateBin's `inflateRaw` rejects.
 *  - `adata` is the GCM additional authenticated data, serialised byte-exactly.
 *    Reordering its keys or re-encoding it after the fact breaks the tag.
 */
export function encryptPaste(text: string, options: EncryptOptions = {}): EncryptedPaste {
  const {
    password = "",
    expire = "1day",
    burnAfterReading = true,
    formatter = "markdown",
  } = options;

  const pasteKey = crypto.randomBytes(PASTE_KEY_BYTES);
  // The password is folded into the KDF input, not checked separately — so the
  // URL on its own is not enough to decrypt a password-protected paste.
  const passphrase = Buffer.concat([pasteKey, Buffer.from(password, "utf8")]);
  const salt = crypto.randomBytes(KDF_SALT_BYTES);
  const iv = crypto.randomBytes(CIPHER_IV_BYTES);
  const kdfKey = crypto.pbkdf2Sync(
    passphrase,
    salt,
    KDF_ITERATIONS,
    KDF_KEYSIZE_BITS / 8,
    "sha256",
  );

  const adata: PasteAdata = [
    [
      iv.toString("base64"),
      salt.toString("base64"),
      KDF_ITERATIONS,
      KDF_KEYSIZE_BITS,
      CIPHER_TAG_BITS,
      "aes",
      "gcm",
      "zlib",
    ],
    formatter,
    0, // open discussion — always off for one-time shares
    burnAfterReading ? 1 : 0,
  ];

  const plaintext = Buffer.from(JSON.stringify({ paste: text }), "utf8");
  const blob = zlib.deflateRawSync(plaintext);

  const cipher = crypto.createCipheriv("aes-256-gcm", kdfKey, iv, {
    authTagLength: CIPHER_TAG_BITS / 8,
  });
  cipher.setAAD(Buffer.from(JSON.stringify(adata), "utf8"));
  const ciphertext = Buffer.concat([cipher.update(blob), cipher.final(), cipher.getAuthTag()]);

  return {
    payload: { v: 2, adata, ct: ciphertext.toString("base64"), meta: { expire } },
    key: base58Encode(pasteKey),
  };
}

/**
 * Decrypt our own payload. Not used in the share flow — the recipient's browser
 * does this — but it keeps the tests honest about round-tripping.
 */
export function decryptPaste(payload: PastePayload, key: string, password = ""): string {
  const [spec] = payload.adata;
  const [ivB64, saltB64, iterations, keySizeBits, tagBits] = spec;
  const pasteKey = base58Decode(key);
  const passphrase = Buffer.concat([pasteKey, Buffer.from(password, "utf8")]);
  const kdfKey = crypto.pbkdf2Sync(
    passphrase,
    Buffer.from(saltB64, "base64"),
    iterations,
    keySizeBits / 8,
    "sha256",
  );

  const tagBytes = tagBits / 8;
  const raw = Buffer.from(payload.ct, "base64");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    kdfKey,
    Buffer.from(ivB64, "base64"),
    { authTagLength: tagBytes },
  );
  decipher.setAAD(Buffer.from(JSON.stringify(payload.adata), "utf8"));
  decipher.setAuthTag(raw.subarray(raw.length - tagBytes));
  const blob = Buffer.concat([decipher.update(raw.subarray(0, raw.length - tagBytes)), decipher.final()]);

  const parsed = JSON.parse(zlib.inflateRawSync(blob).toString("utf8")) as { paste: string };
  return parsed.paste;
}

/** Inverse of {@link base58Encode}. */
export function base58Decode(value: string): Buffer {
  let zeros = 0;
  while (zeros < value.length && value[zeros] === BASE58_ALPHABET[0]) zeros += 1;

  const bytes: number[] = [];
  for (const char of value.slice(zeros)) {
    const digit = BASE58_ALPHABET.indexOf(char);
    if (digit < 0) throw new Error(`Invalid base58 character: ${char}`);
    let carry = digit;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  return Buffer.from([...new Array<number>(zeros).fill(0), ...bytes.reverse()]);
}
