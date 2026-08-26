import { describe, it, expect } from "vitest";
import {
  chooseRepKind,
  hashSeed,
  isColdReadCandidate,
  kindOrder,
  parseNumstatLog,
  pickBySeed,
  repExcludeKey,
  type CommitCandidate,
} from "./reps-generate";

function candidate(overrides: Partial<CommitCandidate> = {}): CommitCandidate {
  return {
    repo: "org/service",
    sha: "abc123",
    committedAt: "2026-08-20T10:00:00Z",
    email: "colleague@example.com",
    author: "A Colleague",
    subject: "fix: handle empty payloads",
    additions: 30,
    deletions: 10,
    files: ["src/handler.ts", "src/handler.test.ts"],
    ...overrides,
  };
}

describe("hashSeed / pickBySeed", () => {
  it("is deterministic and changes with the attempt", () => {
    expect(hashSeed("2026-08-26#0")).toBe(hashSeed("2026-08-26#0"));
    expect(hashSeed("2026-08-26#0")).not.toBe(hashSeed("2026-08-26#1"));
  });

  it("pickBySeed returns null on empty and a stable element otherwise", () => {
    expect(pickBySeed([], 7)).toBeNull();
    const items = ["a", "b", "c"];
    expect(pickBySeed(items, 7)).toBe(pickBySeed(items, 7));
    expect(items).toContain(pickBySeed(items, hashSeed("x")));
  });
});

describe("chooseRepKind", () => {
  it("only picks from available kinds and honors weights", () => {
    expect(chooseRepKind(5, [])).toBeNull();
    expect(chooseRepKind(5, ["recall"])).toBe("recall");
    // With everything available the 7-slot pool is 4 cold reads, 2 gaps, 1 recall.
    const picks = Array.from({ length: 7 }, (_, seed) => chooseRepKind(seed, ["cold-read", "gap-sketch", "recall"]));
    expect(picks.filter((kind) => kind === "cold-read")).toHaveLength(4);
    expect(picks.filter((kind) => kind === "gap-sketch")).toHaveLength(2);
    expect(picks.filter((kind) => kind === "recall")).toHaveLength(1);
  });

  it("kindOrder puts the chosen kind first and covers all kinds", () => {
    const order = kindOrder(hashSeed("2026-08-26#0"));
    expect(order).toHaveLength(3);
    expect(new Set(order)).toEqual(new Set(["cold-read", "gap-sketch", "recall"]));
  });
});

describe("isColdReadCandidate", () => {
  it("keeps a foreign, medium-sized, hand-written commit", () => {
    expect(isColdReadCandidate(candidate(), "me@example.com")).toBe(true);
  });

  it("rejects my own commits, but keeps everything when my email is unknown", () => {
    expect(isColdReadCandidate(candidate({ email: "me@example.com" }), "me@example.com")).toBe(false);
    expect(isColdReadCandidate(candidate({ email: "me@example.com" }), "")).toBe(true);
  });

  it("rejects bot authors — deploy runners and dependabots are not practice material", () => {
    expect(
      isColdReadCandidate(candidate({ author: "dependabot[bot]", email: "49699333+dependabot[bot]@users.noreply.github.com" }), "me@x.com"),
    ).toBe(false);
    expect(
      isColdReadCandidate(candidate({ author: "DaD GitHub Actions", email: "dad+github@example.com" }), "me@x.com"),
    ).toBe(false);
    expect(
      isColdReadCandidate(candidate({ author: "fluxcd-prd-deploy", email: "cloudeng@users.noreply.github.com" }), "me@x.com"),
    ).toBe(false);
  });

  it("rejects merges and reverts", () => {
    expect(isColdReadCandidate(candidate({ subject: "Merge branch 'main'" }), "me@x.com")).toBe(false);
    expect(isColdReadCandidate(candidate({ subject: "Revert \"fix\"" }), "me@x.com")).toBe(false);
  });

  it("rejects trivial and enormous diffs", () => {
    expect(isColdReadCandidate(candidate({ additions: 3, deletions: 2 }), "me@x.com")).toBe(false);
    expect(isColdReadCandidate(candidate({ additions: 900, deletions: 100 }), "me@x.com")).toBe(false);
  });

  it("rejects commits that only touch generated files", () => {
    expect(
      isColdReadCandidate(candidate({ files: ["package-lock.json", "dist/bundle.js"] }), "me@x.com"),
    ).toBe(false);
    expect(
      isColdReadCandidate(candidate({ files: ["package-lock.json", "src/app.ts"] }), "me@x.com"),
    ).toBe(true);
  });
});

describe("parseNumstatLog", () => {
  it("parses commits with numstat totals, treating binary '-' as zero", () => {
    const stdout = [
      "\u001eaaa111\u00002026-08-20T10:00:00Z\u0000A@x.com\u0000Alice\u0000feat: add parser",
      "10\t2\tsrc/parser.ts",
      "5\t0\tsrc/parser.test.ts",
      "",
      "\u001ebbb222\u00002026-08-19T09:00:00Z\u0000B@x.com\u0000Bob\u0000chore: assets",
      "-\t-\tlogo.png",
    ].join("\n");
    const commits = parseNumstatLog("org/service", stdout);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({
      repo: "org/service",
      sha: "aaa111",
      email: "a@x.com",
      author: "Alice",
      subject: "feat: add parser",
      additions: 15,
      deletions: 2,
      files: ["src/parser.ts", "src/parser.test.ts"],
    });
    expect(commits[1]).toMatchObject({ sha: "bbb222", additions: 0, deletions: 0, files: ["logo.png"] });
  });

  it("returns nothing for empty output", () => {
    expect(parseNumstatLog("org/service", "")).toEqual([]);
  });
});

describe("repExcludeKey", () => {
  it("keys each kind by its material identity", () => {
    expect(
      repExcludeKey({
        material: {
          kind: "cold-read", repo: "o/r", sha: "abc", committedAt: "", filesChanged: 1, additions: 1, deletions: 1,
        },
      }),
    ).toBe("cold-read:abc");
    expect(
      repExcludeKey({
        material: {
          kind: "gap-sketch", repo: "o/r", domainId: "ingest", label: "Ingest", paths: [], commits90d: 1, authoredByMe: 0,
        },
      }),
    ).toBe("gap-sketch:o/r:ingest");
    expect(
      repExcludeKey({ material: { kind: "recall", title: "t", diagramPath: "diagrams/a/b" } }),
    ).toBe("recall:diagrams/a/b");
  });
});
