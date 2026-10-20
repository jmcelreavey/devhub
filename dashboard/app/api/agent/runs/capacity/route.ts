import { maxActiveAgentRuns } from "@/lib/agent-runs/dispatch";
import { listCapacityRuns,toAgentRunSummary } from "@/lib/agent-runs/store";
import { reconcileCapacityRuns } from "@/lib/paseo/lifecycle";
import { requireDashboardAuth,withErrorHandler } from "@/lib/api-utils";
import { NextRequest,NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * The runs that count against the dispatch limit, after re-checking each with
 * Paseo. `clearable` marks the ones DevHub can no longer follow: only those
 * can be cleared; a live run has to be stopped.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  await reconcileCapacityRuns();
  const runs = listCapacityRuns().map((run) => ({
    ...toAgentRunSummary(run),
    clearable: run.status.state === "needs-attention" || run.status.connectivity === "reconnecting",
  }));
  return NextResponse.json({ max: maxActiveAgentRuns(), runs });
}, "agent.runs.capacity.get");
