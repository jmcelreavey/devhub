import { NextResponse } from "next/server";
import { isNotesAiConfigured } from "@/lib/notes-ai/config";
import { diffSnapshots } from "@/lib/capability/diff";
import { listSnapshotsMeta, readLatestSnapshot, readPreviousSnapshot } from "@/lib/capability/snapshots";
import type { DiffEntry } from "@/lib/capability/types";
import {
  partitionByAcknowledgement,
  pruneAcknowledgements,
  readAcknowledgements,
} from "@/lib/radar/acknowledgements";

export const dynamic = "force-dynamic";

/**
 * GET /api/capability/radar
 *
 * The diff is still computed as latest-vs-previous snapshot; acknowledgements
 * are applied on top rather than folded into `diffSnapshots`. Keeping them
 * separate means the diff stays a pure function of two snapshots — testable
 * without any user state — and the "what have I already dealt with" question
 * stays in one place, shared with Release Radar.
 */
export function GET() {
  const snapshot = readLatestSnapshot();
  const aiConfigured = isNotesAiConfigured();

  if (!snapshot) {
    return NextResponse.json({ snapshot: null, diff: null, snapshots: [], aiConfigured });
  }

  const previous = readPreviousSnapshot(snapshot.id);
  const diff = diffSnapshots(snapshot, previous);

  // Forget acknowledgements for signals that no longer exist, so the file does
  // not grow forever and a signal that disappears and later returns is not
  // silently suppressed at a watermark nobody remembers setting.
  const store = pruneAcknowledgements("capability", Object.keys(snapshot.signals));

  // Repo count is the magnitude for every capability list: an entry stays
  // hidden while it sits at or below the count you acknowledged, and comes back
  // when it spreads further. The two entry shapes carry it differently —
  // DiffEntry has `repos[]` (with `toRepoCount` set only on `spread`), while
  // DriftEntry has a flat `repoCount` — so the accessor is per-shape rather
  // than a single duck-typed field.
  const diffMagnitude = (entry: DiffEntry) => entry.toRepoCount ?? entry.repos.length;

  const added = partitionByAcknowledgement(
    diff.added, "capability", (e) => e.id, diffMagnitude, store,
  );
  const spread = partitionByAcknowledgement(
    diff.spread, "capability", (e) => e.id, diffMagnitude, store,
  );
  const drift = partitionByAcknowledgement(
    diff.drift, "capability", (e) => e.id, (e) => e.repoCount, store,
  );

  return NextResponse.json({
    snapshot,
    diff: {
      ...diff,
      added: added.visible,
      spread: spread.visible,
      drift: drift.visible,
      // Removed signals are not acknowledgeable: they are gone, the entry is
      // terminal, and there is nothing to re-surface later.
      acknowledged: {
        added: added.acknowledged,
        spread: spread.acknowledged,
        drift: drift.acknowledged,
      },
      acknowledgedCount:
        added.acknowledged.length + spread.acknowledged.length + drift.acknowledged.length,
    },
    snapshots: listSnapshotsMeta(),
    aiConfigured,
    acknowledgements: readAcknowledgements(),
  });
}
