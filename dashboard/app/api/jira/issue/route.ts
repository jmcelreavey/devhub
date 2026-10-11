import { NextRequest, NextResponse } from "next/server";
import { JiraCreateIssueSchema } from "@/lib/schemas";
import { requireDashboardAuth, isSameOriginStrict, parseBody } from "@/lib/api-utils";
import { requestWrite } from "@/lib/integrations/write-store";
import { alertProfile } from "@/lib/integrations/alert-worker";
import { integrationFailure } from "@/lib/integrations/write-api";

export async function POST(req: NextRequest) {
  const auth = requireDashboardAuth(req); if (!auth.ok) return auth.response;
  if (!isSameOriginStrict(req)) return NextResponse.json({ error: "Create and confirm tickets in DevHub." }, { status: 403 });
  const parsed = await parseBody(req, JiraCreateIssueSchema); if (!parsed.ok) return parsed.response;
  try {
    const input = parsed.data;
    const proposal = await requestWrite({ action: "issue.create", provider: "jira", account: "default", projectKey: input.projectKey, title: input.summary, body: input.description, parentKey: input.parentKey ?? null, assignToMe: input.assignToMe ?? true, sprintId: input.sprintId ?? null }, alertProfile());
    return NextResponse.json({ proposal, confirmationRequired: true }, { status: 202, headers: { "x-devhub-confirmation": "required" } });
  } catch (error) { return integrationFailure(error); }
}
