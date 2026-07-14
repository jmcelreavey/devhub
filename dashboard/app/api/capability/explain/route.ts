import { NextRequest, NextResponse } from "next/server";
import { diffSnapshots } from "@/lib/capability/diff";
import { explainDelta } from "@/lib/capability/explain";
import { readLatestSnapshot, readPreviousSnapshot } from "@/lib/capability/snapshots";
import type { DiffEntry } from "@/lib/capability/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  let body: { deltaId?: string; refresh?: boolean } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const deltaId = body.deltaId?.trim();
  if (!deltaId) return NextResponse.json({ error: "deltaId required" }, { status: 400 });

  const snapshot = readLatestSnapshot();
  if (!snapshot) return NextResponse.json({ error: "No snapshot yet — run a scan first." }, { status: 404 });

  const diff = diffSnapshots(snapshot, readPreviousSnapshot(snapshot.id));

  // Prefer the actual diff entry (has from/to counts); fall back to a synthetic
  // entry built from the current rollup so any signal can be explained.
  let entry: DiffEntry | undefined = [...diff.added, ...diff.spread, ...diff.removed].find((e) => e.id === deltaId);
  if (!entry) {
    const roll = snapshot.signals[deltaId];
    if (!roll) return NextResponse.json({ error: `Unknown signal: ${deltaId}` }, { status: 404 });
    entry = {
      id: roll.id,
      label: roll.label,
      kind: roll.kind,
      area: roll.area,
      repos: roll.repos,
      evidence: [],
    };
  }

  try {
    const explanation = await explainDelta(snapshot, entry, body.refresh === true);
    return NextResponse.json(explanation);
  } catch (err) {
    console.error("[api:capability:explain]", err);
    return NextResponse.json({ error: "Explain failed", detail: String(err).slice(0, 200) }, { status: 500 });
  }
}
