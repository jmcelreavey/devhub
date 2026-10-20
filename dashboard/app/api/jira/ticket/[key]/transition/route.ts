import { NextRequest, NextResponse } from "next/server";
import { JiraTransitionSchema } from "@/lib/schemas";
import { requireDashboardAuth, isSameOriginStrict, parseBody } from "@/lib/api-utils";
import { requestWrite, writeNow } from "@/lib/integrations/write-store";
import { alertProfile } from "@/lib/integrations/alert-worker";
import { integrationFailure, isDirectUserRequest, directOutcome, proposalSource } from "@/lib/integrations/write-api";
import { providerFor } from "@/lib/integrations/registry";
import { IntegrationError } from "@/lib/integrations/types";
import { requestedTaskProfile, taskProfileConflict } from "@/lib/tasks/profile-request";

/**
 * A person's click moves the ticket now; an agent or MCP caller gets a proposal
 * that a person confirms. Both leave a record in the same write trail.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const auth = requireDashboardAuth(req); if (!auth.ok) return auth.response;
  if (!isSameOriginStrict(req)) return NextResponse.json({ error: "Review and confirm transitions in DevHub." }, { status: 403 });
  const parsed = await parseBody(req, JiraTransitionSchema); if (!parsed.ok) return parsed.response;
  const profile = requestedTaskProfile(req);
  const conflict = profile ? taskProfileConflict(profile) : null;
  if (conflict) return conflict;
  try {
    const { key } = await params;
    const ref = { provider: "jira", account: "default", kind: "issue", id: key } as const;
    const direct = isDirectUserRequest(req);
    let transitionId = parsed.data.transitionId;
    if (!transitionId) {
      // Undo names the status it wants back; the workflow decides which transition gets there.
      if (!direct) return NextResponse.json({ error: "Name a transitionId." }, { status: 400 });
      const offered = await providerFor("jira").transitions!(ref, { signal: req.signal });
      transitionId = offered.find((t) => t.statusId === parsed.data.toStatusId)?.id;
      if (!transitionId) throw new IntegrationError("conflict", "Jira does not offer a way back to that status from here. Change it in Jira.");
    }
    const input = { action: "issue.transition", provider: "jira", account: "default", ref, transitionId } as const;
    if (!direct) return NextResponse.json({ proposal: await requestWrite(input, alertProfile(), proposalSource(req)), confirmationRequired: true }, { status: 202, headers: { "x-devhub-confirmation": "required" } });
    const changed = profile ? taskProfileConflict(profile) : null;
    if (changed) return changed;
    const result = await writeNow(input, alertProfile(), req.signal);
    const details = result.proposal.prepared?.details ?? {};
    const undo = typeof details.fromStatusId === "string" ? { toStatusId: details.fromStatusId, label: "Move back to " + String(details.from) } : null;
    return directOutcome(result, { key, undo, from: details.from ?? null, to: details.to ?? null, title: details.ticket ?? null });
  } catch (error) { return integrationFailure(error); }
}
