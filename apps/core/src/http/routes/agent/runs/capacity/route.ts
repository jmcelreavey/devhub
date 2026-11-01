import { maxActiveAgentRuns } from "../../../../../lib/agent-runs/dispatch";
import { listCapacityRuns,toAgentRunSummary } from "../../../../../lib/agent-runs/store";
import { reconcileCapacityRuns } from "../../../../../lib/paseo/lifecycle";
import { requireDashboardAuth,withErrorHandler } from "../../../../../lib/api-utils";
import { httpAction } from "../../../../../lib/actions/http";
import { agentCapacity } from "../../../../../../../../packages/shared/actions/agents";


/**
 * The runs that count against the dispatch limit, after re-checking each with
 * Paseo. `clearable` marks the ones DevHub can no longer follow: only those
 * can be cleared; a live run has to be stopped.
 */
export const GET = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  return httpAction(agentCapacity, {
    input: () => ({}),
    context: () => ({ execute: async () => {
      await reconcileCapacityRuns();
      const runs = listCapacityRuns().map((run) => ({
        ...toAgentRunSummary(run),
        clearable: run.status.state === "needs-attention" || run.status.connectivity === "reconnecting",
      }));
      return Response.json({ max: maxActiveAgentRuns(), runs });
    } }),
    response: (response) => response as Response,
  })(req);
}, "agent.runs.capacity.get");
