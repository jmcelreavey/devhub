import { jiraTicketRedirect } from "../../../../../../../../../packages/shared/actions/jira";
import { configuredJiraDomain } from "../../../../../../lib/jira/env";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;
  return jiraTicketRedirect.handler(jiraTicketRedirect.input.parse({ key }), { execute: async ({ key }) => {
    const domain = configuredJiraDomain();
    if (!domain) {
      return Response.json({ error: "Jira not configured" }, { status: 501 });
    }
    const url = `https://${domain}/browse/${key}`;
    return Response.redirect(url, 307);
  } });
}
