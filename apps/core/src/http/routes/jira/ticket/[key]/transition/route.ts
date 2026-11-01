import { jiraTicketTransition, jiraTransitionDashboard, type JiraTransitionContext, type WorkWriteResponse } from "../../../../../../../../../packages/shared/actions/work";
import { httpAction } from "../../../../../../lib/actions/http";
import { JiraTransitionSchema } from "../../../../../../lib/schemas";
import { requireDashboardAuth, isSameOriginStrict, parseBody } from "../../../../../../lib/api-utils";
import { writeNow } from "../../../../../../lib/integrations/write-store";
import { getTaskProfileOverview } from "../../../../../../domains/tasks/profiles";
import { integrationFailure, directOutcome, writeSource } from "../../../../../../lib/integrations/write-api";
import { providerFor } from "../../../../../../lib/integrations/registry";
import { IntegrationError } from "../../../../../../lib/integrations/types";
import { requestedTaskProfile, taskProfileConflict } from "../../../../../../domains/tasks/profile-request";
import { isCodeReviewStatus, queueReadyLinkedDraftPrs, taskIdsForJiraKey } from "../../../../../../domains/tasks/ready-linked-prs";

export async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const auth = requireDashboardAuth(req); if (!auth.ok) return auth.response;
  if (!isSameOriginStrict(req)) return Response.json({ error: "Use a same-origin request." }, { status: 403 });
  const parsed = await parseBody(req, JiraTransitionSchema); if (!parsed.ok) return parsed.response;
  const profile = requestedTaskProfile(req);
  const conflict = profile ? taskProfileConflict(profile) : null;
  if (conflict) return conflict;
  let key: string;
  try { ({ key } = await params); } catch (error) { return integrationFailure(error); }
  const move: JiraTransitionContext["move"] = async (ticketKey, body) => {
    const result = async (response: Response): Promise<WorkWriteResponse> => ({
      status: response.status, body: await response.json(), headers: Object.fromEntries(response.headers),
    });
    try {
      const ref = { provider: "jira", account: "default", kind: "issue", id: ticketKey } as const;
      let transitionId = body.transitionId;
      if (!transitionId) {
        // Undo names the status it wants back; the workflow decides which transition gets there.
        const offered = await providerFor("jira").transitions!(ref, { signal: req.signal });
        transitionId = offered.find((t) => t.statusId === body.toStatusId)?.id;
        if (!transitionId) throw new IntegrationError("conflict", "Jira does not offer a way back to that status from here. Change it in Jira.");
      }
      const input = { action: "issue.transition", provider: "jira", account: "default", ref, transitionId } as const;

      const changed = profile ? taskProfileConflict(profile) : null;
      if (changed) return result(changed);
      const outcome = await writeNow(input, getTaskProfileOverview().active ?? "default", req.signal, { source: writeSource(req) });
      const details = outcome.result.prepared?.details ?? {};
      // Safety net: a ticket moving to Code Review means its task's draft PRs should be up for review too.
      if (outcome.result.state === "succeeded" && isCodeReviewStatus(details.to)) {
        for (const taskId of taskIdsForJiraKey(ticketKey)) queueReadyLinkedDraftPrs(taskId, `${ticketKey} moved to ${String(details.to)}`);
      }
      const undo = typeof details.fromStatusId === "string" ? { toStatusId: details.fromStatusId, label: "Move back to " + String(details.from) } : null;
      return result(directOutcome(outcome, { key: ticketKey, undo, from: details.from ?? null, to: details.to ?? null, title: details.ticket ?? null }));
    } catch (error) { return result(integrationFailure(error)); }
  };
  const response = ({ status, body, headers }: WorkWriteResponse) => Response.json(body, { status, headers });
  if (parsed.data.transitionId) {
    return httpAction(jiraTicketTransition, {
      input: () => ({ key, transitionId: parsed.data.transitionId, confirm: true }),
      context: () => ({ move, list: async () => ({ status: 400, body: { error: "Transition ID required" } }) }),
      response: (result) => result.kind === "moved" ? response(result.response) : Response.json({ error: "Transition ID required" }, { status: 400 }),
    })(req);
  }
  return httpAction(jiraTransitionDashboard, { input: () => ({ key, body: parsed.data }), context: () => ({ move }), response })(req);
}
