import { describe, expect, it } from "vitest";
import { groupUnifiedDiffByFile } from "./git-parsers";

const RAW = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 111..222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +1,4 @@",
  " ctx",
  "-old",
  "+new",
  "+newer",
  "diff --git a/bin/asset b/bin/asset",
  "index 333..444 100644",
  "Binary files /dev/null and b/bin/asset differ",
].join("\n");

describe("groupUnifiedDiffByFile", () => {
  it("splits per file with add/del counts", () => {
    const [a, b] = groupUnifiedDiffByFile(RAW);
    expect(a.path).toBe("src/a.ts");
    expect(a.additions).toBe(2);
    expect(a.deletions).toBe(1);
    expect(a.binary).toBe(false);
    expect(b.path).toBe("bin/asset");
    expect(b.binary).toBe(true);
    expect(b.additions).toBe(0);
  });

  it("handles empty input", () => {
    expect(groupUnifiedDiffByFile("")).toEqual([]);
  });

  it("falls back to the diff --git path when +++ is missing", () => {
    const [only] = groupUnifiedDiffByFile("diff --git a/x/y.ts b/x/y.ts\nsome line\n");
    expect(only.path).toBe("x/y.ts");
  });
});
