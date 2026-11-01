import { requireDashboardAuth, withErrorHandler } from "../../../../../../lib/api-utils";
import { httpAction } from "../../../../../../lib/actions/http";
import { agentDiff } from "../../../../../../../../../packages/shared/actions/agents";
import { agentRunDiff } from "../../../../../../lib/agent-runs/git";
import { readAgentRun } from "../../../../../../lib/agent-runs/store";


interface RouteContext {
  params: Promise<{ id: string }>;
}

/** What the run changed. `?patch=0` returns only the stat and untracked files. */
export const GET = withErrorHandler(async (req: Request, { params }: RouteContext) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const run = readAgentRun((await params).id);
  if (!run) return Response.json({ error: "Agent run not found" }, { status: 404 });
  const includePatch = new URL(req.url).searchParams.get("patch") !== "0";
  return httpAction(agentDiff, {
    input: () => ({ runId: run.spec.id, patch: includePatch }),
    context: () => ({ diff: async ({ patch }) => {
      try {
        return { status: 200, body: { diff: await agentRunDiff(run.spec, patch !== false) } };
      } catch (error) {
        return { status: 502, body: { error: error instanceof Error ? error.message : "git diff failed" } };
      }
    } }),
    response: ({ status, body }) => Response.json(body, { status }),
  })(req);
}, "agent.runs.id.diff");
