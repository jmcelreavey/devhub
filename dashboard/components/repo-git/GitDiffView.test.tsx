import { describe, expect, it } from "vitest";
import { buildSplitRows } from "./GitDiffView";
import type { DiffLine } from "@/lib/repos/git-parsers";

const L = (type: DiffLine["type"], text: string): DiffLine => ({ type, text });

describe("buildSplitRows", () => {
  it("zips del/add runs into pairs", () => {
    const rows = buildSplitRows([L("del", "-a"), L("del", "-b"), L("add", "+1"), L("add", "+2")]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: "pair", left: { line: { text: "-a" } }, right: { line: { text: "+1" } } });
    expect(rows[1]).toMatchObject({ kind: "pair", left: { line: { text: "-b" } }, right: { line: { text: "+2" } } });
  });

  it("pads a shorter side with empty cells", () => {
    const rows = buildSplitRows([L("del", "-a"), L("del", "-b"), L("del", "-c"), L("add", "+1")]);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.right).toBeDefined();
    expect(rows[1]?.right).toBeUndefined();
    expect(rows[2]?.right).toBeUndefined();
  });

  it("keeps context and hunk lines full-width", () => {
    const rows = buildSplitRows([
      L("hunk", "@@ -1,2 +1,2 @@"),
      L("ctx", " shared"),
      L("del", "-old"),
      L("add", "+new"),
    ]);
    expect(rows[0]).toMatchObject({ kind: "wide", wide: { line: { type: "hunk" } } });
    expect(rows[1]).toMatchObject({ kind: "wide", wide: { line: { type: "ctx" } } });
    expect(rows[2]).toMatchObject({ kind: "pair" });
  });

  it("does not pair across a context boundary", () => {
    // A del before ctx and an add after it belong to different changes.
    const rows = buildSplitRows([L("del", "-a"), L("ctx", " x"), L("add", "+b")]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ kind: "pair", left: { line: { text: "-a" } }, right: undefined });
    expect(rows[2]).toMatchObject({ kind: "pair", left: undefined, right: { line: { text: "+b" } } });
  });
});
