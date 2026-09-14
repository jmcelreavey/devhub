import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { agentRunDiff } from "@/lib/agent-runs/git";
import { readAgentRun } from "@/lib/agent-runs/store";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** What the run changed. `?patch=0` returns only the stat and untracked files. */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const run = readAgentRun((await params).id);
  if (!run) return NextResponse.json({ error: "Agent run not found" }, { status: 404 });
  const includePatch = new URL(req.url).searchParams.get("patch") !== "0";
  try {
    return NextResponse.json({ diff: await agentRunDiff(run.spec, includePatch) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "git diff failed" }, { status: 502 });
  }
}, "agent.runs.id.diff");
