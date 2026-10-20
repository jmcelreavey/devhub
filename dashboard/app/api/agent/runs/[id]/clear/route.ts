import { readAgentRun,toAgentRunSummary } from "@/lib/agent-runs/store";
import { clearManagedRun } from "@/lib/paseo/lifecycle";
import { requireDashboardAuth,withErrorHandler } from "@/lib/api-utils";
import { NextRequest,NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Stop counting a run DevHub can no longer follow. Never stops anything in Paseo. */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const run = readAgentRun((await params).id);
  if (!run) return NextResponse.json({ error: "Agent run not found" }, { status: 404 });
  if (run.spec.runtime !== "paseo" && run.spec.runtime !== "aionui") {
    return NextResponse.json({ error: "Only Paseo runs can be cleared. Stop this run from the feature that started it." }, { status: 409 });
  }
  const { run: updated, outcome } = await clearManagedRun(run);
  if (outcome === "still-running") {
    return NextResponse.json({ error: "This agent is still running. Stop it instead of clearing it.", run: toAgentRunSummary(updated) }, { status: 409 });
  }
  return NextResponse.json({ run: toAgentRunSummary(updated), outcome });
}, "agent.runs.id.clear.post");
