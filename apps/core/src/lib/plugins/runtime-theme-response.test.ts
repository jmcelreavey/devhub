import { describe, expect, it } from "vitest";
import { runtimeThemeResponse } from "./runtime-theme-response";

const bytes = Uint8Array.from([1, 2, 3, 4]);

describe("reviewed theme media ranges", () => {
  it.each([
    [null, 200, [1, 2, 3, 4], null],
    ["bytes=0-1", 206, [1, 2], "bytes 0-1/4"],
    ["bytes=2-", 206, [3, 4], "bytes 2-3/4"],
    ["bytes=-2", 206, [3, 4], "bytes 2-3/4"],
    ["bytes=1-99", 206, [2, 3, 4], "bytes 1-3/4"],
    ["bytes=-99", 206, [1, 2, 3, 4], "bytes 0-3/4"],
  ] as const)("serves %s with exact bounds", async (range, status, body, contentRange) => {
    const response = runtimeThemeResponse(bytes, "audio/wav", range);
    expect(response.status).toBe(status);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual(body);
    expect(response.headers.get("content-length")).toBe(String(body.length));
    expect(response.headers.get("content-range")).toBe(contentRange);
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
  });

  it.each(["", "bytes=-", "bytes=-0", "bytes=4-", "bytes=3-2", "bytes=0-1,2-3", "bytes=1.5-2", "bytes=0-9007199254740992", "items=0-1"])("refuses malformed or unsatisfiable range %s", async range => {
    const response = runtimeThemeResponse(bytes, "audio/wav", range);
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */4");
    expect(await response.text()).toBe("");
  });
});
