import { jiraMeta } from "../../../../../../../packages/shared/actions/jira";
import { jiraScreen } from "../../../../lib/integrations/screen-data";
const getJiraMeta = jiraScreen.meta;
import { withErrorHandler } from "../../../../lib/api-utils";

const DEFAULT_PROJECT = process.env.JIRA_DEFAULT_PROJECT?.trim() || "ABC";

/**
 * Detected Jira context for the "Add to Jira" modal: the authenticated user,
 * the project's board + active sprint, and the Team value (optionally inherited
 * from `reference`, e.g. the task's current parent ticket).
 */
export const GET = withErrorHandler(async (req: Request) => {
  if (!process.env.JIRA_DOMAIN) {
    return Response.json({ configured: false }, { status: 200 });
  }
  const url = new URL(req.url);
  const input = jiraMeta.input.parse({ project: url.searchParams.get("project"), reference: url.searchParams.get("reference") });
  return jiraMeta.handler(input, { execute: async ({ project, reference }) => {
    const projectKey = (project || DEFAULT_PROJECT).toUpperCase();
    const meta = await getJiraMeta(projectKey, reference || undefined);
    return Response.json(meta);
  } });
}, "jira.meta");
