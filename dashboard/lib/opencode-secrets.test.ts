import { describe, it, expect } from "vitest";
import { findRawSecretPath, looksLikeRawSecret, ENV_TOKEN_EXACT } from "./opencode-secrets";

describe("ENV_TOKEN_EXACT", () => {
  it("matches well-formed placeholders", () => {
    expect(ENV_TOKEN_EXACT.test("{env:FOO}")).toBe(true);
    expect(ENV_TOKEN_EXACT.test("{env:MY_API_KEY_123}")).toBe(true);
  });

  it("rejects partial or malformed tokens", () => {
    expect(ENV_TOKEN_EXACT.test("{env:}")).toBe(false);
    expect(ENV_TOKEN_EXACT.test("prefix-{env:FOO}")).toBe(false);
    expect(ENV_TOKEN_EXACT.test("{env:FOO}-suffix")).toBe(false);
  });
});

describe("looksLikeRawSecret", () => {
  it("flags raw secret-like values", () => {
    expect(looksLikeRawSecret("apiKey", "sk-rawsecretvalue123")).toBe(true);
    expect(looksLikeRawSecret("api_key", "tok-averylongsecretvalue")).toBe(true);
    expect(looksLikeRawSecret("password", "super-secret-password-123")).toBe(true);
  });

  it("accepts {env:VAR} placeholders", () => {
    expect(looksLikeRawSecret("apiKey", "{env:MY_API_KEY}")).toBe(false);
  });

  it("accepts URLs even at secret-like keys", () => {
    expect(looksLikeRawSecret("apiKey", "https://example.com/api")).toBe(false);
  });

  it("ignores non-secret keys", () => {
    expect(looksLikeRawSecret("baseURL", "sk-rawsecretvalue123")).toBe(false);
    expect(looksLikeRawSecret("name", "sk-rawsecretvalue123")).toBe(false);
  });

  it("ignores short values", () => {
    expect(looksLikeRawSecret("apiKey", "short")).toBe(false);
  });
});

describe("findRawSecretPath", () => {
  it("returns null for clean configs", () => {
    const clean = {
      model: "some/model",
      provider: {
        myprovider: {
          options: { apiKey: "{env:MY_API_KEY}", baseURL: "https://api.example.com" },
        },
      },
    };
    expect(findRawSecretPath(clean)).toBeNull();
  });

  it("returns dotted path for a raw secret in a nested object", () => {
    const dirty = {
      provider: {
        x: {
          options: { apiKey: "sk-rawsecretvalue123" },
        },
      },
    };
    expect(findRawSecretPath(dirty)).toBe("provider.x.options.apiKey");
  });

  it("handles non-objects (string, number, null) without throwing", () => {
    expect(findRawSecretPath("just a string")).toBeNull();
    expect(findRawSecretPath(null)).toBeNull();
    expect(findRawSecretPath(42)).toBeNull();
  });
});
