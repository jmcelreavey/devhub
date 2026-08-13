import { afterEach, describe, expect, it, vi } from "vitest";
import {
  pickAtlassianAvatarUrl,
  rememberAtlassianAvatar,
  resolveAtlassianAvatars,
  trustedAtlassianAvatarUrl,
} from "@/lib/jira/avatars";

vi.mock("@/lib/jira/env", () => ({
  getResolvedJiraEnv: vi.fn(() => null),
  apiBase: vi.fn(),
  jsonHeaders: vi.fn(),
}));

describe("trustedAtlassianAvatarUrl", () => {
  it("allows Atlassian CDNs", () => {
    const url = "https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net/N48x48/x.png";
    expect(trustedAtlassianAvatarUrl(url)).toBe(url);
  });

  it("rejects GitHub and unknown hosts", () => {
    expect(trustedAtlassianAvatarUrl("https://avatars.githubusercontent.com/u/1")).toBeNull();
    expect(trustedAtlassianAvatarUrl("https://evil.test/a.png")).toBeNull();
  });
});

describe("pickAtlassianAvatarUrl", () => {
  it("prefers the largest available size", () => {
    expect(
      pickAtlassianAvatarUrl({
        "24x24": "https://acme.atlassian.net/24.png",
        "48x48": "https://acme.atlassian.net/48.png",
      }),
    ).toBe("https://acme.atlassian.net/48.png");
  });

  it("rejects untrusted hosts inside avatarUrls", () => {
    expect(pickAtlassianAvatarUrl({ "48x48": "https://evil.test/a.png" })).toBeNull();
  });
});

describe("rememberAtlassianAvatar / resolveAtlassianAvatars", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns harvested ticket avatars without Jira configured", async () => {
    rememberAtlassianAvatar(
      "Ada@Example.com",
      "https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net/N48x48/ada.png",
    );
    const map = await resolveAtlassianAvatars(["ada@example.com", "nobody@example.com"]);
    expect(map["ada@example.com"]).toContain("atl-paas.net");
    expect(map["nobody@example.com"]).toBeUndefined();
  });

  it("ignores untrusted harvest attempts", async () => {
    rememberAtlassianAvatar("bad@example.com", "https://evil.test/a.png");
    const map = await resolveAtlassianAvatars(["bad@example.com"]);
    expect(map).toEqual({});
  });
});
