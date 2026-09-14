import { describe, expect, it } from "vitest";
import { avatarColor, githubAvatarUrl, initialsOf, trustedAvatarUrl } from "./CommitAvatar";

describe("initialsOf", () => {
  it("takes first and last initial of a full name", () => {
    expect(initialsOf("John McElreavey", "j@example.com")).toBe("JM");
    expect(initialsOf("Dana Carla Cortés", "d@example.com")).toBe("DC");
  });

  it("takes two letters from a single-word name", () => {
    expect(initialsOf("octocat", "o@example.com")).toBe("OC");
  });

  it("falls back to the local part when there is no name", () => {
    // Bot and CI commits routinely have an email but no display name.
    expect(initialsOf("", "lena.castro@example.com")).toBe("LC");
    expect(initialsOf("   ", "dependabot@example.com")).toBe("DE");
  });

  it("ignores the numeric prefix on a GitHub noreply address", () => {
    // Without stripping it, this reads as "6S" — the digits are not a name.
    expect(initialsOf("", "12345678+Sam-Lee@users.noreply.github.com")).toBe("SL");
  });

  it("returns a placeholder rather than an empty circle", () => {
    expect(initialsOf("", "")).toBe("?");
  });

  it("does not throw on an email with no local part", () => {
    expect(initialsOf("", "@example.com")).toBe("?");
  });
});

describe("avatarColor", () => {
  it("is stable for the same author", () => {
    expect(avatarColor("a@example.com")).toBe(avatarColor("a@example.com"));
  });

  it("separates two authors who sit next to each other in the log", () => {
    // Not a guarantee for every pair — the palette is small — but these two
    // appear adjacent in the sample history and must not collide.
    expect(avatarColor("john@example.com")).not.toBe(avatarColor("grace@example.com"));
  });

  it("always returns a palette colour", () => {
    for (const seed of ["", "a", "zzzzzzzzzzzz", "üñïçødé@example.com"]) {
      expect(avatarColor(seed)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("githubAvatarUrl", () => {
  it("reads the numeric id out of a modern noreply address", () => {
    expect(githubAvatarUrl("12345678+Sam-Lee@users.noreply.github.com", 18)).toBe(
      "https://avatars.githubusercontent.com/u/12345678?s=36",
    );
  });

  it("falls back to the login for a legacy noreply address", () => {
    expect(githubAvatarUrl("Sam-Lee@users.noreply.github.com", 18)).toBe(
      "https://github.com/Sam-Lee.png?size=36",
    );
  });

  it("returns null for an ordinary address", () => {
    expect(githubAvatarUrl("john@example.com", 18)).toBeNull();
    expect(githubAvatarUrl("", 18)).toBeNull();
  });

  it("does not match a lookalike host", () => {
    // The host is interpolated into a URL, so anchoring it matters.
    expect(githubAvatarUrl("a@users.noreply.github.com.evil.test", 18)).toBeNull();
    expect(githubAvatarUrl("a@notusers.noreply.github.com", 18)).toBeNull();
  });

  it("rejects a login carrying path or query characters", () => {
    expect(githubAvatarUrl("ev/il@users.noreply.github.com", 18)).toBeNull();
    expect(githubAvatarUrl("ev?il@users.noreply.github.com", 18)).toBeNull();
  });
});

describe("trustedAvatarUrl", () => {
  it("sizes GitHub avatar URLs", () => {
    expect(trustedAvatarUrl("https://avatars.githubusercontent.com/u/1?v=4", 18)).toContain("s=36");
  });

  it("allows Atlassian avatar hosts", () => {
    const url = "https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net/N48x48/x.png";
    expect(trustedAvatarUrl(url, 18)).toBe(url);
  });

  it("rejects unknown hosts", () => {
    expect(trustedAvatarUrl("https://evil.test/a.png", 18)).toBeNull();
  });
});
