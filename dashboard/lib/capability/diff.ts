/**
 * Capability Radar — diff engine.
 *
 * Compares two aggregate snapshots (or a snapshot against nothing) to produce
 * the "engineering evolution": what's new, what spread, what vanished, and
 * where your hands-on exposure has gone stale while a technology grows.
 */

import { daysSince } from "./exposure";
import type { CapabilityDiff, CapabilitySnapshot, DiffEntry, DriftEntry } from "./types";

/** A signal you haven't touched in this many days counts as drifting. */
export const DRIFT_DAYS = 60;

function entryFrom(snapshot: CapabilitySnapshot, id: string, extra?: Partial<DiffEntry>): DiffEntry {
  const roll = snapshot.signals[id];
  const evidence = collectEvidence(snapshot, id);
  return {
    id,
    label: roll?.label ?? id,
    kind: roll?.kind ?? "technology",
    area: roll?.area ?? "runtime",
    repos: roll?.repos ?? [],
    evidence,
    ...extra,
  };
}

/** Up to a few evidence paths for a signal, pulled from its repo scans. */
function collectEvidence(snapshot: CapabilitySnapshot, id: string): string[] {
  const out: string[] = [];
  for (const repo of snapshot.repos) {
    const sig = repo.signals.find((s) => s.id === id);
    if (!sig) continue;
    for (const e of sig.evidence.slice(0, 2)) {
      out.push(`${repo.repoName}: ${e}`);
      if (out.length >= 6) return out;
    }
  }
  return out;
}

/** Minimum "days since I touched it" for a signal across all repos; null if never/unknown. */
function minDaysSinceMine(snapshot: CapabilitySnapshot, id: string): number | null {
  let best: number | null = null;
  for (const repo of snapshot.repos) {
    if (!repo.signals.some((s) => s.id === id)) continue;
    const d = daysSince(repo.lastTouchedByMe?.[id] ?? null);
    if (d === null) continue;
    best = best === null ? d : Math.min(best, d);
  }
  return best;
}

export function diffSnapshots(
  to: CapabilitySnapshot,
  from: CapabilitySnapshot | null,
): CapabilityDiff {
  const toIds = new Set(Object.keys(to.signals));
  const fromIds = new Set(from ? Object.keys(from.signals) : []);

  const added: DiffEntry[] = [];
  const spread: DiffEntry[] = [];
  for (const id of toIds) {
    if (!fromIds.has(id)) {
      added.push(entryFrom(to, id, { toRepoCount: to.signals[id].repos.length }));
    } else if (from) {
      const before = from.signals[id].repos.length;
      const after = to.signals[id].repos.length;
      if (after > before) {
        spread.push(entryFrom(to, id, { fromRepoCount: before, toRepoCount: after }));
      }
    }
  }

  const removed: DiffEntry[] = [];
  if (from) {
    for (const id of fromIds) {
      if (!toIds.has(id)) removed.push(entryFrom(from, id));
    }
  }

  const drift: DriftEntry[] = [];
  for (const id of toIds) {
    const roll = to.signals[id];
    const days = minDaysSinceMine(to, id);
    // No prior snapshot → nothing to compare, so delta is 0 (avoids flagging
    // every signal as "new drift" on the first scan; `added` already covers new).
    const before = from ? (from.signals[id]?.repos.length ?? 0) : roll.repos.length;
    const repoDelta = roll.repos.length - before;
    const stale = days !== null && days >= DRIFT_DAYS;
    const growingUntouched = days === null && repoDelta > 0;
    if (stale || growingUntouched) {
      drift.push({
        id,
        label: roll.label,
        area: roll.area,
        daysSinceMine: days,
        repoDelta,
        repoCount: roll.repos.length,
      });
    }
  }

  const byRepoCount = (a: DiffEntry, b: DiffEntry) => b.repos.length - a.repos.length;
  added.sort(byRepoCount);
  spread.sort((a, b) => (b.toRepoCount ?? 0) - (b.fromRepoCount ?? 0) - ((a.toRepoCount ?? 0) - (a.fromRepoCount ?? 0)));
  removed.sort(byRepoCount);
  drift.sort((a, b) => {
    // Growing-untouched first, then by staleness, then by spread.
    const an = a.daysSinceMine ?? Number.MAX_SAFE_INTEGER;
    const bn = b.daysSinceMine ?? Number.MAX_SAFE_INTEGER;
    return b.repoDelta - a.repoDelta || bn - an;
  });

  return { fromId: from?.id ?? null, toId: to.id, added, removed, spread, drift };
}
