import { describe, expect, it, vi } from "vitest";
import { checkTypesafeKey, typesafeKeyFormatError } from "./typesafe-key";

const KEY = "apikey_0123456789abcdef";

describe("typesafeKeyFormatError", () => {
  it("accepts a pasted key, surrounding whitespace included", () => {
    expect(typesafeKeyFormatError(`  ${KEY}\n`)).toBeNull();
  });
  it.each([["", "Paste"], ["apikey_ 0123456789abcdef", "spaces"], ["apikey_0123456789abcdé", "unusual"], ["apikey_12", "too short"]])("rejects %j", (key, message) => {
    expect(typesafeKeyFormatError(key)).toContain(message);
  });
});

describe("checkTypesafeKey", () => {
  it("calls the free models endpoint with the key as a bearer token", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    await expect(checkTypesafeKey(KEY, fetchImpl as unknown as typeof fetch)).resolves.toMatchObject({ ok: true, code: "connected" });
    expect(fetchImpl).toHaveBeenCalledWith("https://api.typesafe.ai/v1/models", expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${KEY}` }) }));
  });

  it("explains a rejected key without echoing it or the response", async () => {
    const fetchImpl = vi.fn(async () => new Response(`bad key ${KEY}`, { status: 401 }));
    const result = await checkTypesafeKey(KEY, fetchImpl as unknown as typeof fetch);
    expect(result).toMatchObject({ ok: false, code: "auth_failed" });
    expect(result.message).not.toContain(KEY);
  });

  it("never sends a missing or malformed key", async () => {
    const fetchImpl = vi.fn();
    await expect(checkTypesafeKey(undefined, fetchImpl as unknown as typeof fetch)).resolves.toMatchObject({ code: "missing_key" });
    await expect(checkTypesafeKey("has spaces in it ok", fetchImpl as unknown as typeof fetch)).resolves.toMatchObject({ code: "bad_format" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports an unreachable service and other HTTP errors plainly", async () => {
    await expect(checkTypesafeKey(KEY, vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch)).resolves.toMatchObject({ code: "unreachable" });
    await expect(checkTypesafeKey(KEY, vi.fn(async () => new Response("", { status: 503 })) as unknown as typeof fetch)).resolves.toMatchObject({ code: "http_error", message: expect.stringContaining("503") });
  });
});
