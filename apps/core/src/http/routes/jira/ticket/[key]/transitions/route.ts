import { jiraTransitionsList, type WorkWriteResponse } from "../../../../../../../../../packages/shared/actions/work";
import { httpAction } from "../../../../../../lib/actions/http";
import { jiraScreen } from "../../../../../../lib/integrations/screen-data";
const getTransitions = jiraScreen.transitions;
import { withErrorHandler, notConfigured } from "../../../../../../lib/api-utils";

/** Available workflow transitions for a ticket (for the complete/abandon prompt). */
const readTransitions = withErrorHandler(
  async (_req: Request, { params }: { params: Promise<{ key: string }> }) => {
    const { key } = await params;
    if (!process.env.JIRA_DOMAIN) {
      return notConfigured("Jira");
    }
    const transitions = await getTransitions(key);
    return Response.json({ key, transitions });
  },
  "jira.transitions.get",
);

export async function GET(req: Request, routeParams: { params: Promise<{ key: string }> }) {
  const { key } = await routeParams.params;
  return httpAction(jiraTransitionsList, {
    input: () => ({ key }),
    context: () => ({ list: async () => {
      const response = await readTransitions(req, routeParams);
      return { status: response.status, body: await response.json(), headers: Object.fromEntries(response.headers) };
    } }),
    response: ({ status, body, headers }: WorkWriteResponse) => Response.json(body, { status, headers }),
  })(req);
}
