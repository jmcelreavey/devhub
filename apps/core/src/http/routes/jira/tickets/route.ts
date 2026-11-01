import { jiraTickets } from "../../../../../../../packages/shared/actions/work";
import { httpAction } from "../../../../lib/actions/http";
import { withErrorHandler } from "../../../../lib/api-utils";
import { jiraScreen } from "../../../../lib/integrations/screen-data";
const getMyTickets = jiraScreen.tickets;
import { getResolvedJiraEnv } from "../../../../lib/jira/env";
import {
  getJiraTicketsCache,
  setJiraTicketsCache,
  JIRA_TICKETS_TTL_MS,
} from "../../../../lib/jira/tickets-cache";

const readTickets = withErrorHandler<[]>(async () => {
  if (!getResolvedJiraEnv()) {
    return Response.json({ tickets: [], configured: false });
  }

  const cached = getJiraTicketsCache();
  if (cached && Date.now() - cached.ts < JIRA_TICKETS_TTL_MS) {
    return Response.json({ tickets: cached.data, cached: true, configured: true });
  }

  try {
    const tickets = await getMyTickets();
    setJiraTicketsCache(tickets);
    return Response.json({ tickets, cached: false, configured: true });
  } catch {
    return Response.json(
      { error: "Couldn't load Jira tickets. Check the connection and retry.", configured: true },
      { status: 502 },
    );
  }
}, "jira.tickets.get");

export const GET = httpAction(jiraTickets, {
  input: () => ({}),
  context: () => ({ list: async () => {
    const response = await readTickets();
    return { status: response.status, body: await response.json() };
  } }),
  response: ({ status, body }) => Response.json(body, { status }),
});
