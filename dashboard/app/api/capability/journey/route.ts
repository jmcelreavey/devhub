import { NextRequest, NextResponse } from "next/server";
import { getLab, listLabRecords } from "@/lib/capability/journey";
import { readLatestSnapshot } from "@/lib/capability/snapshots";

export const dynamic = "force-dynamic";

/**
 * List generated labs (optionally for one repo) so the UI can show which
 * signals already have a lab — and its done state — before anyone clicks.
 */
export function GET(req: NextRequest) {
  const repoName = req.nextUrl.searchParams.get("repoName")?.trim() || undefined;
  const labs = listLabRecords()
    .filter((r) => !repoName || r.repoName === repoName)
    .map(({ category, signalId, label, repoName: repo, generatedAt, source, done, completedAt, workspacePath }) => ({
      category,
      signalId,
      label,
      repoName: repo,
      generatedAt,
      source,
      done,
      completedAt,
      hasWorkspace: !!workspacePath,
    }))
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  return NextResponse.json({ labs });
}

/**
 * Fetch an existing lab. Read-only: generation happens in OpenCode (the
 * capability-lab skill), which registers the result via /journey/adopt.
 */
export async function POST(req: NextRequest) {
  let body: { signalId?: string; repoName?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const signalId = body.signalId?.trim();
  if (!signalId) return NextResponse.json({ error: "signalId required" }, { status: 400 });

  const snapshot = readLatestSnapshot();
  if (!snapshot) return NextResponse.json({ error: "No snapshot yet — run a scan first." }, { status: 404 });

  try {
    const lab = getLab(snapshot, { signalId, repoName: body.repoName?.trim() || undefined });
    if (!lab) {
      return NextResponse.json(
        { error: "No lab yet — build it with OpenCode from the UI.", notBuilt: true },
        { status: 404 },
      );
    }
    return NextResponse.json(lab);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // "Unknown signal" / "No local repo" are client-fixable → 404; else 500.
    const status = /unknown signal|no local repo/i.test(message) ? 404 : 500;
    if (status === 500) console.error("[api:capability:journey]", err);
    return NextResponse.json({ error: message.slice(0, 200) }, { status });
  }
}
