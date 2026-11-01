import { jiraTicketGet } from "../../../../../../../../packages/shared/actions/work";
import { httpAction } from "../../../../../lib/actions/http";
import { jiraScreen } from "../../../../../lib/integrations/screen-data";
const getTicket = jiraScreen.ticket;
import { notConfigured } from "../../../../../lib/api-utils";

async function readTicket(
  _req: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;

  if (!process.env.JIRA_DOMAIN) {
    return notConfigured("Jira");
  }

  try {
    const ticket = await getTicket(key);
    if (!ticket) return Response.json({ error: "Not found" }, { status: 404 });

    const parentDetail = ticket.parent ? await getTicket(ticket.parent.key).catch(() => null) : null;

    return Response.json({
      key: ticket.key,
      status: ticket.status,
      summary: ticket.summary,
      issuetype: ticket.issuetype,
      assignee: ticket.assignee ?? null,
      parent: ticket.parent ? { ...ticket.parent, issuetype: parentDetail?.issuetype } : null,
      grandparent: parentDetail?.parent ?? null,
    });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export async function GET(req: Request, routeParams: { params: Promise<{ key: string }> }) {
  const { key } = await routeParams.params;
  return httpAction(jiraTicketGet, {
    input: () => ({ key }),
    context: () => ({ get: async () => {
      const response = await readTicket(req, routeParams);
      return { status: response.status, body: await response.json() };
    } }),
    response: ({ status, body }) => Response.json(body, { status }),
  })(req);
}
