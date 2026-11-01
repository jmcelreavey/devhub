import { agentUsage } from "../../../../../../packages/shared/actions/agent-cli";
import { requireDashboardAuth, withErrorHandler } from "../../../lib/api-utils";
import { loadAgentUsage } from "../../../lib/agent-usage/index";


export const GET = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const { refresh } = agentUsage.input.parse({ refresh: new URL(req.url).searchParams.get("refresh") ?? undefined });
  return Response.json(await agentUsage.handler({ refresh }, { execute: async ({ refresh }) => ({ providers: await loadAgentUsage(refresh) }) }), { headers: { "Cache-Control": "no-store" } });
}, "agent-usage");
