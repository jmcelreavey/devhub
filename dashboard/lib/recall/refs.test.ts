import { describe, expect, it } from "vitest";
import { extractRefKeys, extractRefs, mergeDerivedRefs, refFromKey } from "./refs";

describe("extractRefs", () => {
  it("pulls Jira keys out of prose", () => {
    const refs = extractRefs("Fixed PTF-3774 after DP-6122 regressed");
    expect(refs.map((r) => r.id)).toEqual(["PTF-3774", "DP-6122"]);
    expect(refs[0].kind).toBe("jira");
  });

  it("deduplicates repeated mentions, first label winning", () => {
    const refs = extractRefs("PTF-1 again. PTF-1 still. PTF-1.");
    expect(refs).toHaveLength(1);
  });

  it("reads owner/repo#n and GitHub URLs as the same PR entity", () => {
    const short = extractRefs("see jmcelreavey/devhub#525");
    const url = extractRefs("see https://github.com/jmcelreavey/devhub/pull/525");
    expect(short[0].id).toBe("jmcelreavey/devhub#525");
    expect(url[0].id).toBe("jmcelreavey/devhub#525");
  });

  it("matches full SHAs but not short ones", () => {
    const full = "a".repeat(40);
    expect(extractRefs(`fixed in ${full}`).some((r) => r.id === `commit:${full}`)).toBe(true);
    // Short SHAs are indistinguishable from hex ids and colours; matching them
    // was measured at ~40 junk entities per note.
    expect(extractRefs("fixed in a1b2c3d").filter((r) => r.kind === "repo")).toHaveLength(0);
  });

  it("does not invent tickets from lowercase hyphenated words", () => {
    expect(extractRefs("use the notes-search-2 module")).toHaveLength(0);
  });

  it("reads wiki links and task markers", () => {
    const refs = extractRefs("[[learnings/devhub/caching]] and ::task-ref abc123 2026-01-01 x");
    expect(refs.map((r) => r.kind)).toContain("note");
    expect(refs.map((r) => r.kind)).toContain("task");
  });

  it("only treats owner/repo as a repo when asked, and never a file path", () => {
    expect(extractRefs("lib/recall/refs.ts")).toHaveLength(0);
    expect(extractRefs("lib/recall", { includeRepoSlugs: true }).map((r) => r.id)).toEqual([
      "lib/recall",
    ]);
    expect(extractRefs("lib/refs.ts", { includeRepoSlugs: true })).toHaveLength(0);
  });

  it("returns [] for empty input rather than throwing", () => {
    expect(extractRefs("")).toEqual([]);
    expect(extractRefKeys("")).toEqual([]);
  });

  it("extracts #tags but not bare issue numbers or PR short forms", () => {
    const refs = extractRefs("shipped the fix #auth #devhub, see owner/repo#123 and (#525)");
    const tags = refs.filter((r) => r.kind === "tag");
    expect(tags.map((t) => t.id)).toEqual(["auth", "devhub"]);
    expect(tags[0].label).toBe("#auth");
    // PR short form survives untouched — no tag collision.
    expect(refs.some((r) => r.kind === "pr" && r.id === "owner/repo#123")).toBe(true);
  });

  it("round-trips a tag key through refFromKey", () => {
    expect(refFromKey("tag:perf")).toEqual({
      kind: "tag",
      id: "perf",
      label: "#perf",
      href: "/work?tag=perf",
    });
  });

  it("caps output on a pathological document", () => {
    const text = Array.from({ length: 500 }, (_, i) => `AB-${i}`).join(" ");
    expect(extractRefs(text).length).toBeLessThanOrEqual(64);
  });
});

describe("mergeDerivedRefs", () => {
  it("lets explicit refs win on label", () => {
    const merged = mergeDerivedRefs(
      [{ kind: "jira", id: "PTF-1", label: "The ticket that broke prod" }],
      [{ kind: "jira", id: "PTF-1", label: "PTF-1" }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].label).toBe("The ticket that broke prod");
  });

  it("keeps derived refs that have no explicit counterpart", () => {
    const merged = mergeDerivedRefs([], [{ kind: "jira", id: "PTF-2", label: "PTF-2" }]);
    expect(merged).toHaveLength(1);
  });
});

describe("refFromKey", () => {
  it("round-trips the keys extraction produces", () => {
    for (const ref of extractRefs("PTF-3774 and owner/repo#12 and [[a/b]]")) {
      const key = `${ref.kind}:${ref.id}`;
      expect(refFromKey(key)?.id).toBe(ref.id);
    }
  });

  it("rejects malformed keys", () => {
    expect(refFromKey("nonsense")).toBeNull();
    expect(refFromKey("jira:")).toBeNull();
    expect(refFromKey(":PTF-1")).toBeNull();
    expect(refFromKey("unknownkind:x")).toBeNull();
  });
});
