import { describe, expect, it } from "vitest";
import { buildSnapshot } from "./aggregate";
import { diffSnapshots } from "./diff";
import { buildDigestHeadline, buildDigestMarkdown, digestCounts } from "./digest";
import type { DetectedSignal, RepoScan } from "./types";

function sig(id: string, over: Partial<DetectedSignal> = {}): DetectedSignal {
  return { id, label: id, kind: "technology", area: "infra", evidence: [`${id}/f.yaml`], count: 1, confidence: 0.9, ...over };
}

function repo(name: string, signals: DetectedSignal[], touched: Record<string, string | null> = {}): RepoScan {
  return {
    repoName: name,
    repoRef: `/repos/${name}`,
    source: "local",
    sha: "abc",
    depth: "full",
    scannedAt: "2026-07-01T00:00:00.000Z",
    signals,
    lastTouchedByMe: touched,
  };
}

describe("buildDigestHeadline", () => {
  it("lists new tech and counts arch shifts", () => {
    const from = buildSnapshot([repo("a", [sig("terraform")])], "2026-06-01T00:00:00.000Z");
    const to = buildSnapshot(
      [
        repo("a", [sig("terraform")]),
        repo("b", [sig("crossplane", { area: "infra" })]),
        repo("c", [sig("karpenter", { area: "deploy" })]),
      ],
      "2026-07-01T00:00:00.000Z",
    );
    const diff = diffSnapshots(to, from);
    const headline = buildDigestHeadline(diff);
    expect(headline).toContain("+crossplane");
    expect(headline).toContain("+karpenter");
    expect(headline).toContain("2 arch shifts");
  });

  it("says 'no changes' on a steady week", () => {
    const from = buildSnapshot([repo("a", [sig("terraform")])], "2026-06-01T00:00:00.000Z");
    const to = buildSnapshot([repo("a", [sig("terraform")])], "2026-07-01T00:00:00.000Z");
    const diff = diffSnapshots(to, from);
    expect(buildDigestHeadline(diff)).toBe("This week: no changes");
  });

  it("caps the new list at three and rolls the rest into '+N more'", () => {
    const to = buildSnapshot(
      [repo("a", [sig("a1"), sig("a2"), sig("a3"), sig("a4"), sig("a5")])],
      "2026-07-01T00:00:00.000Z",
    );
    const diff = diffSnapshots(to, buildSnapshot([], "2026-06-01T00:00:00.000Z"));
    expect(buildDigestHeadline(diff)).toContain("+2 more");
  });
});

describe("digestCounts", () => {
  it("counts added / spread / removed / drift", () => {
    const from = buildSnapshot([repo("a", [sig("flux"), sig("datadog")])], "2026-06-01T00:00:00.000Z");
    const to = buildSnapshot(
      [repo("a", [sig("flux"), sig("terraform")]), repo("b", [sig("flux")])],
      "2026-07-01T00:00:00.000Z",
    );
    const diff = diffSnapshots(to, from);
    const counts = digestCounts(diff);
    expect(counts.added).toBe(1); // terraform
    expect(counts.spread).toBe(1); // flux 1→2
    expect(counts.removed).toBe(1); // datadog
  });
});

describe("buildDigestMarkdown", () => {
  it("renders a headline and per-category sections grounded in the diff", () => {
    const from = buildSnapshot([repo("a", [sig("flux")])], "2026-06-01T00:00:00.000Z");
    const to = buildSnapshot(
      [repo("a", [sig("flux")]), repo("b", [sig("crossplane")])],
      "2026-07-01T00:00:00.000Z",
    );
    const diff = diffSnapshots(to, from);
    const md = buildDigestMarkdown(to, diff);
    expect(md).toContain("# This week:");
    expect(md).toContain("## New");
    expect(md).toContain("crossplane");
    expect(md).toContain("2 repos scanned");
  });

  it("notes a steady state when nothing changed", () => {
    const from = buildSnapshot([repo("a", [sig("flux")])], "2026-06-01T00:00:00.000Z");
    const to = buildSnapshot([repo("a", [sig("flux")])], "2026-07-01T00:00:00.000Z");
    const diff = diffSnapshots(to, from);
    expect(buildDigestMarkdown(to, diff)).toContain("No changes since the last scan");
  });
});
