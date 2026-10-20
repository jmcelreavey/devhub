import { NextRequest, NextResponse } from "next/server";
import { JiraCreateIssueSchema } from "@/lib/schemas";
import { requireDashboardAuth, isSameOriginStrict, parseBody } from "@/lib/api-utils";
import { requestWrite, writeNow } from "@/lib/integrations/write-store";
import { alertProfile } from "@/lib/integrations/alert-worker";
import { integrationFailure, isDirectUserRequest, directOutcome, proposalSource } from "@/lib/integrations/write-api";

export async function POST(req: NextRequest) {
  const auth = requireDashboardAuth(req); if (!auth.ok) return auth.response;
  if (!isSameOriginStrict(req)) return NextResponse.json({ error: "Create and confirm tickets in DevHub." }, { status: 403 });
  const parsed = await parseBody(req, JiraCreateIssueSchema); if (!parsed.ok) return parsed.response;
  try {
    const input = parsed.data;
    const write = { action: "issue.create", provider: "jira", account: "default", projectKey: input.projectKey, title: input.summary, body: input.description, parentKey: input.parentKey ?? null, assignToMe: input.assignToMe ?? true, sprintId: input.sprintId ?? null } as const;
    if (!isDirectUserRequest(req)) return NextResponse.json({ proposal: await requestWrite(write, alertProfile(), proposalSource(req)), confirmationRequired: true }, { status: 202, headers: { "x-devhub-confirmation": "required" } });
    const result = await writeNow(write, alertProfile(), req.signal);
    const item = result.proposal.receipt?.item;
    return directOutcome(result, { key: item?.ref.id, url: item?.url }, 201);
  } catch (error) { return integrationFailure(error); }
}
