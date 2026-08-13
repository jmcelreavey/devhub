import { describe, expect, it } from "vitest";
import { analyseManifests } from "./analyse";
import { compareMajorLines, majorDistance, majorLine } from "./versions";
import type { RepoManifest } from "./manifests";

function manifest(
  repoName: string,
  deps: Record<string, string>,
  kind: "prod" | "dev" = "prod",
): RepoManifest {
  return {
    repoName,
    manifestPath: `/repos/${repoName}/package.json`,
    dependencies: Object.entries(deps).map(([name, range]) => ({ name, range, kind })),
  };
}

describe("majorLine", () => {
  it("reads the major from common range syntaxes", () => {
    expect(majorLine("^18.2.0")).toBe("18");
    expect(majorLine("~4.1.3")).toBe("4");
    expect(majorLine("19.0.0")).toBe("19");
    expect(majorLine("v3.1.0")).toBe("3");
    expect(majorLine(">=2.0.0 <3")).toBe("2");
  });

  it("treats pre-1.0 minors as separate lines", () => {
    // ^0.3 and ^0.4 are breaking-incompatible under npm's caret rules. Reading
    // both as major 0 would report every 0.x package as falsely aligned.
    expect(majorLine("^0.3.1")).toBe("0.3");
    expect(majorLine("^0.4.0")).toBe("0.4");
    expect(majorLine("0.3.1")).not.toBe(majorLine("0.4.0"));
  });

  it("returns null for ranges that name no single line", () => {
    for (const range of ["*", "x", "latest", "1 || 2", ">=1", "<3"]) {
      expect(majorLine(range), range).toBeNull();
    }
  });

  it("returns null for protocol ranges", () => {
    for (const range of ["workspace:*", "file:../shared", "npm:foo@^1", "github:a/b"]) {
      expect(majorLine(range), range).toBeNull();
    }
  });

  it("returns null rather than throwing on junk", () => {
    expect(majorLine("")).toBeNull();
    expect(majorLine("   ")).toBeNull();
    expect(majorLine("not-a-version")).toBeNull();
  });
});

describe("compareMajorLines / majorDistance", () => {
  it("sorts newest first", () => {
    expect(["17", "19", "18"].sort(compareMajorLines)).toEqual(["19", "18", "17"]);
  });

  it("orders pre-1.0 lines by minor", () => {
    expect(["0.3", "0.11", "0.4"].sort(compareMajorLines)).toEqual(["0.11", "0.4", "0.3"]);
  });

  it("measures distance in major steps", () => {
    expect(majorDistance("17", "19")).toBe(2);
    expect(majorDistance("0.3", "0.5")).toBe(2);
    expect(majorDistance("18", "18")).toBe(0);
  });
});

describe("analyseManifests", () => {
  it("reports a package split across major lines", () => {
    const [advisory] = analyseManifests([
      manifest("web", { react: "^19.0.0" }),
      manifest("admin", { react: "^17.0.2" }),
      manifest("docs", { react: "^17.0.2" }),
    ]);

    expect(advisory.name).toBe("react");
    expect(advisory.latestLine).toBe("19");
    expect(advisory.behindRepos).toEqual(["admin", "docs"]);
    expect(advisory.spread).toBe(2);
    expect(advisory.repoCount).toBe(3);
  });

  it("says nothing when the estate agrees", () => {
    // Alignment is the desired state. A row per aligned package is exactly the
    // noise that made the drift list unreadable.
    expect(
      analyseManifests(
        [manifest("web", { react: "^19.0.0" }), manifest("admin", { react: "^19.1.0" })],
        { minRepos: 2, minBehind: 1 },
      ),
    ).toEqual([]);
  });

  it("ignores a package only one repo uses", () => {
    expect(analyseManifests([manifest("web", { react: "^19.0.0" })])).toEqual([]);
  });

  it("does not treat workspace links as a version decision", () => {
    // Two repos, one real version and one workspace link, is not a divergence.
    expect(
      analyseManifests(
        [manifest("web", { "@acme/ui": "^2.0.0" }), manifest("admin", { "@acme/ui": "workspace:*" })],
        { minRepos: 2, minBehind: 1 },
      ),
    ).toEqual([]);
  });

  it("flags dev-only divergence but marks it as such", () => {
    const [advisory] = analyseManifests(
      [manifest("web", { eslint: "^9.0.0" }, "dev"), manifest("admin", { eslint: "^8.0.0" }, "dev")],
      { minRepos: 2, minBehind: 1 },
    );
    expect(advisory.devOnly).toBe(true);
  });

  it("can exclude dev-only divergence", () => {
    const manifests = [
      manifest("web", { eslint: "^9.0.0" }, "dev"),
      manifest("admin", { eslint: "^8.0.0" }, "dev"),
    ];
    expect(analyseManifests(manifests, { prodOnly: true, minRepos: 2, minBehind: 1 })).toEqual([]);
  });

  it("counts a package as prod if any repo declares it as prod", () => {
    const [advisory] = analyseManifests(
      [manifest("web", { redis: "^4.0.0" }, "prod"), manifest("admin", { redis: "^3.0.0" }, "dev")],
      { minRepos: 2, minBehind: 1 },
    );
    expect(advisory.devOnly).toBe(false);
  });

  it("ranks by how much of the estate is inconsistent, not by raw major distance", () => {
    // The lesson from real data. Major numbers are not comparable across
    // packages: googleapis ships past v170, so a routine lag scored spread=110
    // and dominated the list, while the genuine estate problem - a package on
    // six different lines across sixteen repos - sorted ninth.
    const advisories = analyseManifests(
      [
        manifest("a", { googleapis: "^171.0.0", "@types/node": "^24.0.0" }),
        manifest("b", { googleapis: "^61.0.0", "@types/node": "^22.0.0" }),
        manifest("c", { googleapis: "^61.0.0", "@types/node": "^20.0.0" }),
        manifest("d", { "@types/node": "^18.0.0" }),
        manifest("e", { "@types/node": "^18.0.0" }),
      ],
      { minRepos: 2 },
    );

    expect(advisories[0].name).toBe("@types/node");
    // googleapis still has by far the larger raw spread, and no longer wins.
    const googleapis = advisories.find((a) => a.name === "googleapis")!;
    expect(googleapis.spread).toBeGreaterThan(advisories[0].spread);
  });

  it("drops a lone straggler by default", () => {
    // One repo behind is a to-do, not a pattern, and it was the single biggest
    // source of volume: 112 rows became 46.
    const manifests = [
      manifest("a", { pkg: "^2.0.0" }),
      manifest("b", { pkg: "^2.0.0" }),
      manifest("c", { pkg: "^1.0.0" }),
    ];
    expect(analyseManifests(manifests)).toEqual([]);
    expect(analyseManifests(manifests, { minBehind: 1 })).toHaveLength(1);
  });

  it("requires three repos by default", () => {
    const two = [manifest("a", { pkg: "^2.0.0" }), manifest("b", { pkg: "^1.0.0" })];
    expect(analyseManifests(two)).toEqual([]);
    expect(analyseManifests(two, { minRepos: 2, minBehind: 1 })).toHaveLength(1);
  });

  it("groups every repo on each line", () => {
    const [advisory] = analyseManifests([
      manifest("a", { pkg: "^2.0.0" }),
      manifest("b", { pkg: "^1.0.0" }),
      manifest("c", { pkg: "^1.5.0" }),
    ], { minBehind: 1 });
    expect(advisory.lines).toEqual([
      { line: "2", repos: ["a"] },
      { line: "1", repos: ["b", "c"] },
    ]);
  });

  it("uses repoCount as the acknowledgement watermark, so spreading re-surfaces it", () => {
    // Acknowledging at 3 repos must not silence the row once a fourth repo
    // adopts a divergent line.
    const before = analyseManifests([
      manifest("a", { pkg: "^2.0.0" }),
      manifest("b", { pkg: "^1.0.0" }),
      manifest("c", { pkg: "^1.0.0" }),
    ]);
    const after = analyseManifests([
      ...[manifest("a", { pkg: "^2.0.0" }), manifest("b", { pkg: "^1.0.0" })],
      manifest("c", { pkg: "^1.0.0" }),
      manifest("d", { pkg: "^1.0.0" }),
    ]);
    expect(before[0].repoCount).toBe(3);
    expect(after[0].repoCount).toBe(4);
  });
});

describe("monorepos with several manifests", () => {
  function multi(repoName: string, ranges: string[]): RepoManifest[] {
    return ranges.map((range, i) => ({
      repoName,
      manifestPath: `/repos/${repoName}/pkg${i}/package.json`,
      dependencies: [{ name: "pkg", range, kind: "prod" as const }],
    }));
  }

  it("counts a repo once even when several of its manifests are behind", () => {
    // Found in the browser: "@types/node — 16 of 16 repos behind v26", which is
    // impossible on its face because one repo was on v26. A repo appears once
    // per line it uses, and a plain flatMap counted devhub twice (root and
    // dashboard/).
    const [advisory] = analyseManifests(
      [...multi("mono", ["^3.0.0", "^2.0.0", "^1.0.0"]), ...multi("other", ["^4.0.0"])],
      { minRepos: 2, minBehind: 1 },
    );
    expect(advisory.behindRepos).toEqual(["mono"]);
    expect(advisory.behindRepos.length).toBeLessThanOrEqual(advisory.repoCount);
  });

  it("does not call a repo behind when one of its manifests is already current", () => {
    // It has done the upgrade somewhere, so it is a place to copy from rather
    // than work to schedule. The lagging package still shows on expand.
    const [advisory] = analyseManifests(
      [...multi("mono", ["^4.0.0", "^1.0.0"]), ...multi("laggard", ["^1.0.0"])],
      { minRepos: 2, minBehind: 1 },
    );
    expect(advisory.latestLine).toBe("4");
    expect(advisory.behindRepos).toEqual(["laggard"]);
    expect(advisory.lines.find((l) => l.line === "1")!.repos).toContain("mono");
  });
});
