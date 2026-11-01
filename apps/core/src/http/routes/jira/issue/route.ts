import { jiraCreateDashboard, jiraTicketCreate, jiraTicketCreateInput, type JiraCreateContext, type WorkWriteResponse } from "../../../../../../../packages/shared/actions/work";
import { httpAction } from "../../../../lib/actions/http";
import { JiraCreateIssueSchema } from "../../../../lib/schemas";
import { requireDashboardAuth, isSameOriginStrict, parseBody } from "../../../../lib/api-utils";
import { writeNow } from "../../../../lib/integrations/write-store";
import { getTaskProfileOverview } from "../../../../domains/tasks/profiles";
import { integrationFailure, directOutcome } from "../../../../lib/integrations/write-api";

export async function POST(req: Request) {
  const auth = requireDashboardAuth(req); if (!auth.ok) return auth.response;
  if (!isSameOriginStrict(req)) return Response.json({ error: "Use a same-origin request." }, { status: 403 });
  const parsed = await parseBody(req, JiraCreateIssueSchema); if (!parsed.ok) return parsed.response;
  const create: JiraCreateContext["create"] = async (input) => {
    try {
      const write = { action: "issue.create", provider: "jira", account: "default", projectKey: input.projectKey, title: input.summary, body: input.description, parentKey: input.parentKey ?? null, assignToMe: input.assignToMe ?? true, sprintId: input.sprintId ?? null } as const;

      const result = await writeNow(write, (getTaskProfileOverview().active ?? "default"), req.signal);
      const item = result.result.receipt?.item;
      const response = directOutcome(result, { key: item?.ref.id, url: item?.url }, 201);
      return { status: response.status, body: await response.json(), headers: Object.fromEntries(response.headers) };
    } catch (error) {
      const response = integrationFailure(error);
      return { status: response.status, body: await response.json(), headers: Object.fromEntries(response.headers) };
    }
  };
  const response = ({ status, body, headers }: WorkWriteResponse) => Response.json(body, { status, headers });
  const input = { ...parsed.data, confirm: true };
  const paired = jiraTicketCreateInput.safeParse(input);
  if (paired.success && !parsed.data.issuetypeName && paired.data.summary === parsed.data.summary && paired.data.description === parsed.data.description) {
    return httpAction(jiraTicketCreate, {
      input: () => input,
      context: () => ({ create }),
      response: (result) => result.kind === "created" ? response(result.response) : Response.json({ error: "Confirmation required" }, { status: 400 }),
    })(req);
  }
  return httpAction(jiraCreateDashboard, { input: () => parsed.data, context: () => ({ create }), response })(req);
}
