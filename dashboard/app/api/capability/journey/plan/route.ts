import { NextRequest, NextResponse } from "next/server";
import { planLab } from "@/lib/capability/journey";
import { readLatestSnapshot } from "@/lib/capability/snapshots";

export const dynamic = "force-dynamic";

/**
 * Everything the capability-lab OpenCode skill needs to build a lab for a
 * signal (target repo, evidence, workspace dir, services, language, notes
 * path). The client turns this into an `opencode run` command for the
 * terminal dock.
 */
export async function GET(req: NextRequest) {
  const signalId = req.nextUrl.searchParams.get("signalId")?.trim();
  if (!signalId) return NextResponse.json({ error: "signalId required" }, { status: 400 });
  const repoName = req.nextUrl.searchParams.get("repoName")?.trim() || undefined;

  const snapshot = readLatestSnapshot();
  if (!snapshot) return NextResponse.json({ error: "No snapshot yet — run a scan first." }, { status: 404 });

  try {
    const plan = await planLab(snapshot, { signalId, repoName });
    return NextResponse.json(plan);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /unknown signal|no local repo/i.test(message) ? 404 : 500;
    if (status === 500) console.error("[api:capability:journey:plan]", err);
    return NextResponse.json({ error: message.slice(0, 200) }, { status });
  }
}
