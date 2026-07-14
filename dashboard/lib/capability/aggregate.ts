/**
 * Capability Radar — roll per-repo scans up into an aggregate snapshot.
 * Pure: no I/O, so it's shared by the scanner and the tests.
 */

import { snapshotIdFromDate } from "./snapshots";
import type { CapabilitySnapshot, RepoScan, SignalRollup } from "./types";

export function buildSnapshot(repoScans: RepoScan[], createdAt: string = new Date().toISOString()): CapabilitySnapshot {
  const signals: Record<string, SignalRollup> = {};

  for (const repo of repoScans) {
    for (const sig of repo.signals) {
      const roll = (signals[sig.id] ??= {
        id: sig.id,
        label: sig.label,
        kind: sig.kind,
        area: sig.area,
        repos: [],
        count: 0,
      });
      if (!roll.repos.includes(repo.repoName)) roll.repos.push(repo.repoName);
      roll.count += sig.count;
    }
  }

  for (const roll of Object.values(signals)) roll.repos.sort();

  return {
    id: snapshotIdFromDate(createdAt),
    createdAt,
    repoCount: repoScans.length,
    source: {
      local: repoScans.filter((r) => r.source === "local").length,
      github: repoScans.filter((r) => r.source === "github").length,
    },
    signals,
    repos: repoScans,
  };
}
