import { NextRequest, NextResponse } from "next/server";
import { JiraTransitionSchema } from "@/lib/schemas";
import { requireDashboardAuth, isSameOriginStrict, parseBody } from "@/lib/api-utils";
import { writeNow } from "@/lib/integrations/write-store";
import { getTaskProfileOverview } from "@/lib/tasks/profiles";
import { integrationFailure, directOutcome, writeSource } from "@/lib/integrations/write-api";
import { providerFor } from "@/lib/integrations/registry";
import { IntegrationError } from "@/lib/integrations/types";
import { requestedTaskProfile, taskProfileConflict } from "@/lib/tasks/profile-request";
import { isCodeReviewStatus, queueReadyLinkedDraftPrs, taskIdsForJiraKey } from "@/lib/tasks/ready-linked-prs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const auth = requireDashboardAuth(req); if (!auth.ok) return auth.response;
  if (!isSameOriginStrict(req)) return NextResponse.json({ error: "Use a same-origin request." }, { status: 403 });
  const parsed = await parseBody(req, JiraTransitionSchema); if (!parsed.ok) return parsed.response;
  const profile = requestedTaskProfile(req);
  const conflict = profile ? taskProfileConflict(profile) : null;
  if (conflict) return conflict;
  try {
    const { key } = await params;
    const ref = { provider: "jira", account: "default", kind: "issue", id: key } as const;
    let transitionId = parsed.data.transitionId;
    if (!transitionId) {
      // Undo names the status it wants back; the workflow decides which transition gets there.
      const offered = await providerFor("jira").transitions!(ref, { signal: req.signal });
      transitionId = offered.find((t) => t.statusId === parsed.data.toStatusId)?.id;
      if (!transitionId) throw new IntegrationError("conflict", "Jira does not offer a way back to that status from here. Change it in Jira.");
    }
    const input = { action: "issue.transition", provider: "jira", account: "default", ref, transitionId } as const;

    const changed = profile ? taskProfileConflict(profile) : null;
    if (changed) return changed;
    const result = await writeNow(input, getTaskProfileOverview().active ?? "default", req.signal, { source: writeSource(req) });
    const details = result.result.prepared?.details ?? {};
    // Safety net: a ticket moving to Code Review means its task's draft PRs should be up for review too.
    if (result.result.state === "succeeded" && isCodeReviewStatus(details.to)) {
      for (const taskId of taskIdsForJiraKey(key)) queueReadyLinkedDraftPrs(taskId, `${key} moved to ${String(details.to)}`);
    }
    const undo = typeof details.fromStatusId === "string" ? { toStatusId: details.fromStatusId, label: "Move back to " + String(details.from) } : null;
    return directOutcome(result, { key, undo, from: details.from ?? null, to: details.to ?? null, title: details.ticket ?? null });
  } catch (error) { return integrationFailure(error); }
}
