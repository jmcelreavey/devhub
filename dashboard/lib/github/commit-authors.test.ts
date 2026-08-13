import { describe, expect, it } from "vitest";
import { parseCommitAuthors } from "@/lib/github/commit-authors";

function entry(email: string | null, login: string | null, avatar: string | null) {
  return {
    commit: { author: email === null ? null : { email } },
    author: login === null ? null : { login, avatar_url: avatar },
  };
}

describe("parseCommitAuthors", () => {
  it("maps a commit email to the GitHub account that owns it", () => {
    const map = parseCommitAuthors([
      entry("gocampos@truelogic.io", "gocampos", "https://avatars.githubusercontent.com/u/1672471?v=4"),
    ]);
    expect(map["gocampos@truelogic.io"]).toEqual({
      login: "gocampos",
      avatarUrl: "https://avatars.githubusercontent.com/u/1672471?v=4",
    });
  });

  it("lowercases the email so lookups match the parsed log", () => {
    const map = parseCommitAuthors([
      entry("Scott-Fischer@Users.NoReply.GitHub.com", "Scott-Fischer", "https://avatars.githubusercontent.com/u/8835133?v=4"),
    ]);
    expect(map["scott-fischer@users.noreply.github.com"]?.login).toBe("Scott-Fischer");
  });

  it("skips commits GitHub could not attribute", () => {
    // author: null is what a commit from an address with no account looks like.
    // Leaving it out is what lets the caller fall through to Gravatar.
    expect(parseCommitAuthors([entry("nobody@example.com", null, null)])).toEqual({});
  });

  it("keeps the first account seen for an email", () => {
    const map = parseCommitAuthors([
      entry("a@example.com", "first", "https://avatars.githubusercontent.com/u/1?v=4"),
      entry("a@example.com", "second", "https://avatars.githubusercontent.com/u/2?v=4"),
    ]);
    expect(map["a@example.com"]?.login).toBe("first");
  });

  it("rejects an avatar hosted anywhere but GitHub's CDN", () => {
    // The value lands in an img src and arrives over the network, so the host
    // is checked rather than trusted.
    for (const bad of [
      "https://evil.test/a.png",
      "http://avatars.githubusercontent.com/u/1",
      "https://avatars.githubusercontent.com.evil.test/u/1",
      "javascript:alert(1)",
    ]) {
      expect(parseCommitAuthors([entry("a@example.com", "a", bad)])).toEqual({});
    }
  });

  it("ignores malformed entries rather than throwing", () => {
    expect(parseCommitAuthors([entry(null, "a", "https://avatars.githubusercontent.com/u/1")])).toEqual({});
    expect(parseCommitAuthors([{}, { commit: null, author: null }])).toEqual({});
    expect(parseCommitAuthors([])).toEqual({});
  });
});
