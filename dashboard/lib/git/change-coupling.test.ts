import { describe, expect, it } from "vitest";
import { buildCouplingIndex, suggestCompanions } from "./change-coupling";

/** n commits that always touch the same pair. */
function pairCommits(a: string, b: string, n: number) {
  return Array.from({ length: n }, () => ({ files: [a, b] }));
}

describe("buildCouplingIndex", () => {
  it("ignores single-file commits — they couple nothing", () => {
    const index = buildCouplingIndex([{ files: ["a.ts"] }, { files: ["b.ts"] }]);
    expect(index.commitsAnalysed).toBe(0);
    expect(index.pairCounts.size).toBe(0);
  });

  it("skips sweeping commits that would couple everything to everything", () => {
    const sweep = { files: Array.from({ length: 40 }, (_, i) => `f${i}.ts`) };
    const index = buildCouplingIndex([sweep, { files: ["a.ts", "b.ts"] }]);
    expect(index.commitsAnalysed).toBe(1);
    expect(index.fileCounts.get("f0.ts")).toBeUndefined();
  });

  it("counts a file once per commit even if listed twice", () => {
    const index = buildCouplingIndex([{ files: ["a.ts", "a.ts", "b.ts"] }]);
    expect(index.fileCounts.get("a.ts")).toBe(1);
  });
});

describe("suggestCompanions", () => {
  it("suggests the companion you left out", () => {
    const index = buildCouplingIndex(pairCommits("src/bi-ops.ts", "src/bi-ops.test.ts", 8));
    const out = suggestCompanions(index, ["src/bi-ops.ts"]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      path: "src/bi-ops.test.ts",
      together: 8,
      confidence: 1,
      because: "src/bi-ops.ts",
    });
  });

  it("says nothing when the companion is already in the change set", () => {
    const index = buildCouplingIndex(pairCommits("a.ts", "a.test.ts", 8));
    expect(suggestCompanions(index, ["a.ts", "a.test.ts"])).toEqual([]);
  });

  it("ignores pairs without enough history to mean anything", () => {
    const index = buildCouplingIndex(pairCommits("a.ts", "b.ts", 2));
    expect(suggestCompanions(index, ["a.ts"])).toEqual([]);
  });

  it("is directional, so a promiscuous file is not suggested everywhere", () => {
    // globals.css appears with everything; each individual partner is a small
    // fraction of its history, but globals.css is 100% of each partner's.
    const commits = [
      ...pairCommits("globals.css", "a.tsx", 6),
      ...pairCommits("globals.css", "b.tsx", 6),
      ...pairCommits("globals.css", "c.tsx", 6),
    ];
    const index = buildCouplingIndex(commits);

    // Touching a.tsx really does imply globals.css (6/6).
    expect(suggestCompanions(index, ["a.tsx"])[0]).toMatchObject({ path: "globals.css" });

    // Touching globals.css implies no single partner (6/18 = 33%).
    expect(suggestCompanions(index, ["globals.css"])).toEqual([]);
  });

  it("keeps the strongest reason when two changed files point at the same companion", () => {
    const index = buildCouplingIndex([
      ...pairCommits("weak.ts", "shared.ts", 6),
      ...Array.from({ length: 4 }, () => ({ files: ["weak.ts", "other.ts"] })),
      ...pairCommits("strong.ts", "shared.ts", 6),
    ]);
    const out = suggestCompanions(index, ["weak.ts", "strong.ts"]);
    const shared = out.find((s) => s.path === "shared.ts");
    expect(shared?.because).toBe("strong.ts");
    expect(shared?.confidence).toBe(1);
  });

  it("honours explicit thresholds", () => {
    const index = buildCouplingIndex(pairCommits("a.ts", "b.ts", 3));
    expect(suggestCompanions(index, ["a.ts"], { minSupport: 3 })).toHaveLength(1);
    expect(suggestCompanions(index, ["a.ts"], { minSupport: 4 })).toEqual([]);
  });

  it("returns nothing for a file with no history", () => {
    const index = buildCouplingIndex(pairCommits("a.ts", "b.ts", 8));
    expect(suggestCompanions(index, ["brand-new.ts"])).toEqual([]);
  });
});
