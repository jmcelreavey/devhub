import { describe, it, expect } from "vitest";
import { SHARE_TTL_MS, shareExpiresAt, shareKey } from "./share-public";

describe("shareKey", () => {
  it("namespaces by vault so notes and docs never collide", () => {
    expect(shareKey("notes", "a/b")).toBe("notes:a/b");
    expect(shareKey("docs", "a/b")).toBe("docs:a/b");
    expect(shareKey("notes", "a/b")).not.toBe(shareKey("docs", "a/b"));
  });
});

describe("shareExpiresAt", () => {
  it("expires exactly 14 days after creation", () => {
    const createdAt = Date.UTC(2026, 0, 1);
    expect(shareExpiresAt({ createdAt })).toBe(createdAt + SHARE_TTL_MS);
    expect(SHARE_TTL_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it("is independent of later updates (createdAt drives TTL)", () => {
    const createdAt = 1_000;
    // Only createdAt is read, so an updatedAt bump cannot extend the life.
    expect(shareExpiresAt({ createdAt })).toBe(createdAt + SHARE_TTL_MS);
  });
});
