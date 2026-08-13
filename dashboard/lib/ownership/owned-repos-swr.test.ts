import { describe, expect, it } from "vitest";
import {
  OWNED_REPOS_SWR_KEY,
  OWNED_REPOS_SUMMARY_SWR_KEY,
  isOwnedReposListKey,
} from "./owned-repos-swr";

describe("isOwnedReposListKey", () => {
  it("matches the list and summary keys", () => {
    expect(isOwnedReposListKey(OWNED_REPOS_SWR_KEY)).toBe(true);
    expect(isOwnedReposListKey(OWNED_REPOS_SUMMARY_SWR_KEY)).toBe(true);
    expect(isOwnedReposListKey("/api/own?summary=1&extra=0")).toBe(true);
  });

  it("ignores per-repo ownership panels", () => {
    expect(isOwnedReposListKey("/api/own/acme/widgets/brief")).toBe(false);
    expect(isOwnedReposListKey("/api/own/acme/widgets/gaps")).toBe(false);
    expect(isOwnedReposListKey("/api/repos")).toBe(false);
    expect(isOwnedReposListKey(null)).toBe(false);
  });
});
