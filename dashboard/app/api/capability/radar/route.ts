import { NextResponse } from "next/server";
import { isNotesAiConfigured } from "@/lib/notes-ai/config";
import { diffSnapshots } from "@/lib/capability/diff";
import { listSnapshotsMeta, readLatestSnapshot, readPreviousSnapshot } from "@/lib/capability/snapshots";

export const dynamic = "force-dynamic";

export function GET() {
  const snapshot = readLatestSnapshot();
  const aiConfigured = isNotesAiConfigured();

  if (!snapshot) {
    return NextResponse.json({ snapshot: null, diff: null, snapshots: [], aiConfigured });
  }

  const previous = readPreviousSnapshot(snapshot.id);
  const diff = diffSnapshots(snapshot, previous);
  return NextResponse.json({
    snapshot,
    diff,
    snapshots: listSnapshotsMeta(),
    aiConfigured,
  });
}
