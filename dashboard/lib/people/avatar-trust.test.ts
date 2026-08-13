import { describe, expect, it } from "vitest";
import { fullResolutionAvatarUrl, isTrustedAvatarHost, trustedAvatarUrl } from "@/lib/people/avatar-trust";

describe("isTrustedAvatarHost", () => {
  it("allows GitHub and Atlassian avatar CDNs", () => {
    expect(isTrustedAvatarHost("avatars.githubusercontent.com")).toBe(true);
    expect(isTrustedAvatarHost("github.com")).toBe(true);
    expect(isTrustedAvatarHost("avatar-management--avatars.us-west-2.prod.public.atl-paas.net")).toBe(
      true,
    );
    expect(isTrustedAvatarHost("api.atlassian.com")).toBe(true);
    expect(isTrustedAvatarHost("acme.atlassian.net")).toBe(true);
  });

  it("rejects lookalikes", () => {
    expect(isTrustedAvatarHost("evil.atl-paas.net.evil.test")).toBe(false);
    expect(isTrustedAvatarHost("avatars.githubusercontent.com.evil.test")).toBe(false);
    expect(isTrustedAvatarHost("evil.test")).toBe(false);
  });
});

describe("trustedAvatarUrl", () => {
  it("sizes GitHub avatar URLs", () => {
    expect(trustedAvatarUrl("https://avatars.githubusercontent.com/u/1?v=4", 18)).toContain("s=36");
  });

  it("allows Atlassian avatar hosts as-is", () => {
    const url = "https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net/N48x48/x.png";
    expect(trustedAvatarUrl(url, 18)).toBe(url);
  });

  it("rejects unknown hosts and non-https", () => {
    expect(trustedAvatarUrl("https://evil.test/a.png", 18)).toBeNull();
    expect(trustedAvatarUrl("http://avatars.githubusercontent.com/u/1", 18)).toBeNull();
  });
});

describe("fullResolutionAvatarUrl", () => {
  it("bumps GitHub size params", () => {
    expect(fullResolutionAvatarUrl("https://avatars.githubusercontent.com/u/1?s=36")).toContain("s=512");
    expect(fullResolutionAvatarUrl("https://github.com/octocat.png?size=36")).toContain("size=512");
  });

  it("rewrites Atlassian N48x48 paths and numeric size queries", () => {
    const path = "https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net/N48x48/x.png";
    expect(fullResolutionAvatarUrl(path)).toContain("/N512x512/");
    const query = "https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net/x.png?s=48&size=48";
    const out = fullResolutionAvatarUrl(query)!;
    expect(out).toContain("s=512");
    expect(out).toContain("size=512");
  });

  it("promotes Atlassian named sizes to xlarge", () => {
    expect(fullResolutionAvatarUrl("https://acme.atlassian.net/avatar?size=medium")).toContain("size=xlarge");
  });

  it("sizes Gravatar without adding it to the general allowlist", () => {
    expect(isTrustedAvatarHost("www.gravatar.com")).toBe(false);
    expect(fullResolutionAvatarUrl("https://www.gravatar.com/avatar/abc?s=36&d=404")).toContain("s=512");
  });

  it("rejects unknown hosts", () => {
    expect(fullResolutionAvatarUrl("https://evil.test/a.png")).toBeNull();
  });
});
