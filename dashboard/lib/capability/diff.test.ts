import { describe, expect, it } from "vitest";
import { buildSnapshot } from "./aggregate";
import { diffSnapshots, DRIFT_DAYS } from "./diff";
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

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

describe("diffSnapshots", () => {
  it("reports added signals against an empty baseline", () => {
    const to = buildSnapshot([repo("a", [sig("terraform")])], "2026-07-01T00:00:00.000Z");
    const diff = diffSnapshots(to, null);
    expect(diff.fromId).toBeNull();
    expect(diff.added.map((e) => e.id)).toEqual(["terraform"]);
    expect(diff.removed).toEqual([]);
    expect(diff.spread).toEqual([]);
  });

  it("detects a newly introduced technology between two snapshots", () => {
    const from = buildSnapshot([repo("a", [sig("terraform")])], "2026-06-01T00:00:00.000Z");
    const to = buildSnapshot(
      [repo("a", [sig("terraform")]), repo("b", [sig("crossplane")])],
      "2026-07-01T00:00:00.000Z",
    );
    const diff = diffSnapshots(to, from);
    expect(diff.added.map((e) => e.id)).toEqual(["crossplane"]);
    expect(diff.added[0].repos).toEqual(["b"]);
  });

  it("detects spread (same tech, more repos)", () => {
    const from = buildSnapshot([repo("a", [sig("flux")])], "2026-06-01T00:00:00.000Z");
    const to = buildSnapshot(
      [repo("a", [sig("flux")]), repo("b", [sig("flux")])],
      "2026-07-01T00:00:00.000Z",
    );
    const diff = diffSnapshots(to, from);
    expect(diff.spread.map((e) => e.id)).toEqual(["flux"]);
    expect(diff.spread[0].fromRepoCount).toBe(1);
    expect(diff.spread[0].toRepoCount).toBe(2);
  });

  it("detects removed signals", () => {
    const from = buildSnapshot([repo("a", [sig("terraform"), sig("datadog")])], "2026-06-01T00:00:00.000Z");
    const to = buildSnapshot([repo("a", [sig("terraform")])], "2026-07-01T00:00:00.000Z");
    const diff = diffSnapshots(to, from);
    expect(diff.removed.map((e) => e.id)).toEqual(["datadog"]);
  });

  it("flags drift when a stale signal grows", () => {
    const from = buildSnapshot([repo("a", [sig("terraform")])], "2026-06-01T00:00:00.000Z");
    const to = buildSnapshot(
      [
        repo("a", [sig("terraform")], { terraform: daysAgo(DRIFT_DAYS + 30) }),
        repo("b", [sig("terraform")], { terraform: daysAgo(DRIFT_DAYS + 30) }),
      ],
      "2026-07-01T00:00:00.000Z",
    );
    const diff = diffSnapshots(to, from);
    const drift = diff.drift.find((d) => d.id === "terraform");
    expect(drift).toBeDefined();
    expect(drift!.repoDelta).toBe(1);
    expect(drift!.daysSinceMine).toBeGreaterThanOrEqual(DRIFT_DAYS);
  });

  it("does not flag drift for recently touched signals", () => {
    const to = buildSnapshot([repo("a", [sig("terraform")], { terraform: daysAgo(3) })], "2026-07-01T00:00:00.000Z");
    const diff = diffSnapshots(to, null);
    expect(diff.drift.find((d) => d.id === "terraform")).toBeUndefined();
  });

  it("does not flag drift on a fresh baseline when exposure is unknown", () => {
    // No previous snapshot + null exposure => repoDelta 0 => no noise.
    const to = buildSnapshot([repo("a", [sig("terraform")])], "2026-07-01T00:00:00.000Z");
    const diff = diffSnapshots(to, null);
    expect(diff.drift).toEqual([]);
  });
});
