import { readAgentRun,toAgentRunSummary } from "../../../../../../lib/agent-runs/store";
import { clearManagedRun } from "../../../../../../lib/paseo/lifecycle";
import { requireDashboardAuth,withErrorHandler } from "../../../../../../lib/api-utils";
import { httpAction } from "../../../../../../lib/actions/http";
import { agentClear } from "../../../../../../../../../packages/shared/actions/agents";


interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Stop counting a run DevHub can no longer follow. Never stops anything in Paseo. */
export const POST = withErrorHandler(async (req: Request, { params }: RouteContext) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  return httpAction(agentClear, {
    input: () => ({ id }),
    context: () => ({ execute: ({ id }) => clearRun(id) }),
    response: (response) => response as Response,
  })(req);
}, "agent.runs.id.clear.post");

async function clearRun(id: string) {
  const run = readAgentRun(id);
  if (!run) return Response.json({ error: "Agent run not found" }, { status: 404 });
  if (run.spec.runtime !== "paseo" && run.spec.runtime !== "aionui") {
    return Response.json({ error: "Only Paseo runs can be cleared. Stop this run from the feature that started it." }, { status: 409 });
  }
  const { run: updated, outcome } = await clearManagedRun(run);
  if (outcome === "still-running") {
    return Response.json({ error: "This agent is still running. Stop it instead of clearing it.", run: toAgentRunSummary(updated) }, { status: 409 });
  }
  return Response.json({ run: toAgentRunSummary(updated), outcome });
}
