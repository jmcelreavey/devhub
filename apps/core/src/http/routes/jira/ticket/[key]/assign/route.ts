import { jiraAssignDashboard, jiraTicketAssign, jiraTicketAssignInput, type JiraAssignContext, type WorkWriteResponse } from "../../../../../../../../../packages/shared/actions/work";
import { httpAction } from "../../../../../../lib/actions/http";
import { JiraAssignSchema } from "../../../../../../lib/schemas";
import { requireDashboardAuth, isSameOriginStrict, parseBody } from "../../../../../../lib/api-utils";
import { writeNow } from "../../../../../../lib/integrations/write-store";
import { getTaskProfileOverview } from "../../../../../../domains/tasks/profiles";
import { integrationFailure, directOutcome, writeSource } from "../../../../../../lib/integrations/write-api";
import { requestedTaskProfile, taskProfileConflict } from "../../../../../../domains/tasks/profile-request";

/** Assign a ticket directly: "me" (default), an accountId, or a name/email matching one Jira user. */
export async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const auth = requireDashboardAuth(req); if (!auth.ok) return auth.response;
  if (!isSameOriginStrict(req)) return Response.json({ error: "Use a same-origin request." }, { status: 403 });
  const parsed = await parseBody(req, JiraAssignSchema); if (!parsed.ok) return parsed.response;
  const profile = requestedTaskProfile(req);
  const conflict = profile ? taskProfileConflict(profile) : null;
  if (conflict) return conflict;
  let key: string;
  try { ({ key } = await params); } catch (error) { return integrationFailure(error); }
  const assign: JiraAssignContext["assign"] = async (ticketKey, assignee) => {
    const result = async (response: Response): Promise<WorkWriteResponse> => ({
      status: response.status, body: await response.json(), headers: Object.fromEntries(response.headers),
    });
    try {
      const ref = { provider: "jira", account: "default", kind: "issue", id: ticketKey } as const;
      const input = { action: "issue.assign", provider: "jira", account: "default", ref, assignee } as const;
      const outcome = await writeNow(input, getTaskProfileOverview().active ?? "default", req.signal, { source: writeSource(req) });
      const details = outcome.result.prepared?.details ?? {};
      return result(directOutcome(outcome, {
        key: ticketKey,
        assignee: details.assignee ?? null,
        assigneeAccountId: details.assigneeAccountId ?? null,
        from: details.from ?? null,
        fromAccountId: details.fromAccountId ?? null,
        title: details.ticket ?? null,
      }));
    } catch (error) { return result(integrationFailure(error)); }
  };
  const response = ({ status, body, headers }: WorkWriteResponse) => Response.json(body, { status, headers });
  const input = { key, assignee: parsed.data.assignee, confirm: true };
  if (jiraTicketAssignInput.safeParse(input).success) {
    return httpAction(jiraTicketAssign, {
      input: () => input,
      context: () => ({ assign }),
      response: (result) => result.kind === "assigned" ? response(result.response) : Response.json({ error: "Confirmation required" }, { status: 400 }),
    })(req);
  }
  return httpAction(jiraAssignDashboard, { input: () => ({ key, assignee: parsed.data.assignee }), context: () => ({ assign }), response })(req);
}
