import { describe, expect, it } from "vitest";
import {
  isSafeRemoteName,
  isSafeRemoteUrl,
  parseRemotes,
  remoteOfUpstream,
  webLinkRemote,
  type Remote,
} from "@/lib/repos/remote-parsers";

const VERBOSE = [
  "origin\tgit@github.com:me/fork.git (fetch)",
  "origin\tgit@github.com:me/fork.git (push)",
  "upstream\thttps://github.com/org/real.git (fetch)",
  "upstream\thttps://github.com/org/real.git (push)",
].join("\n");

function remote(name: string, url = `https://example.test/${name}.git`): Remote {
  return { name, fetchUrl: url, pushUrl: url };
}

describe("parseRemotes", () => {
  it("collapses the fetch and push lines into one remote", () => {
    const remotes = parseRemotes(VERBOSE);
    expect(remotes).toHaveLength(2);
    expect(remotes[0]).toMatchObject({
      name: "origin",
      fetchUrl: "git@github.com:me/fork.git",
      pushUrl: "git@github.com:me/fork.git",
    });
  });

  it("keeps a separately configured push URL", () => {
    const remotes = parseRemotes(
      ["origin\thttps://read.test/x.git (fetch)", "origin\tgit@write.test:x.git (push)"].join("\n"),
    );
    expect(remotes[0]).toMatchObject({
      fetchUrl: "https://read.test/x.git",
      pushUrl: "git@write.test:x.git",
    });
  });

  it("fills the missing direction when only one is configured", () => {
    const [only] = parseRemotes("origin\thttps://x.test/a.git (fetch)");
    expect(only?.pushUrl).toBe("https://x.test/a.git");
  });

  it("puts origin first and the rest alphabetically", () => {
    const remotes = parseRemotes(
      [
        "zed\thttps://x.test/z.git (fetch)",
        "alpha\thttps://x.test/a.git (fetch)",
        "origin\thttps://x.test/o.git (fetch)",
      ].join("\n"),
    );
    expect(remotes.map((r) => r.name)).toEqual(["origin", "alpha", "zed"]);
  });

  it("handles a URL containing spaces", () => {
    const [only] = parseRemotes("origin\t/Users/me/My Repos/x.git (fetch)");
    expect(only?.fetchUrl).toBe("/Users/me/My Repos/x.git");
  });

  it("ignores junk and empty input", () => {
    expect(parseRemotes("not a remote line")).toEqual([]);
    expect(parseRemotes("")).toEqual([]);
  });
});

describe("remoteOfUpstream", () => {
  it("finds the remote an upstream ref belongs to", () => {
    expect(remoteOfUpstream("upstream/main", parseRemotes(VERBOSE))).toBe("upstream");
  });

  it("prefers the longest matching name", () => {
    // Both `origin` and `origin-fork` prefix-match `origin-fork/main`, and only
    // the longer one is right.
    const remotes = [remote("origin"), remote("origin-fork")];
    expect(remoteOfUpstream("origin-fork/main", remotes)).toBe("origin-fork");
  });

  it("returns null for no upstream or an unknown remote", () => {
    expect(remoteOfUpstream(null, parseRemotes(VERBOSE))).toBeNull();
    expect(remoteOfUpstream("nowhere/main", parseRemotes(VERBOSE))).toBeNull();
  });
});

describe("webLinkRemote", () => {
  it("follows the branch's own upstream", () => {
    // Linking a fork's branch at the upstream repo produces a 404 — the code is
    // on the fork.
    expect(webLinkRemote(parseRemotes(VERBOSE), "origin/my-feature")?.name).toBe("origin");
    expect(webLinkRemote(parseRemotes(VERBOSE), "upstream/main")?.name).toBe("upstream");
  });

  it("falls back to origin when there is no upstream", () => {
    expect(webLinkRemote(parseRemotes(VERBOSE), null)?.name).toBe("origin");
  });

  it("falls back to the only remote when it is not called origin", () => {
    expect(webLinkRemote([remote("fork")], null)?.name).toBe("fork");
  });

  it("returns null when there are no remotes", () => {
    expect(webLinkRemote([], "origin/main")).toBeNull();
  });
});

describe("isSafeRemoteName", () => {
  it("accepts ordinary names", () => {
    for (const name of ["origin", "upstream", "my-fork", "fork.2", "a_b"]) {
      expect(isSafeRemoteName(name)).toBe(true);
    }
  });

  it("rejects anything that could be read as an option or a path", () => {
    // The value is interpolated into git argv.
    for (const name of ["--upload-pack=evil", "-x", "a/b", "a b", "", "  "]) {
      expect(isSafeRemoteName(name)).toBe(false);
    }
  });
});

describe("isSafeRemoteUrl", () => {
  it("accepts the shapes git takes", () => {
    for (const url of [
      "https://github.com/org/repo.git",
      "git@github.com:org/repo.git",
      "ssh://git@host/repo.git",
      "/Users/me/repo.git",
    ]) {
      expect(isSafeRemoteUrl(url)).toBe(true);
    }
  });

  it("rejects a leading dash and unrecognised shapes", () => {
    for (const url of ["--upload-pack=evil", "not a url", ""]) {
      expect(isSafeRemoteUrl(url)).toBe(false);
    }
  });
});
