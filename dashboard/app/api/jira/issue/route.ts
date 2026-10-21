import { NextRequest, NextResponse } from "next/server";
import { JiraCreateIssueSchema } from "@/lib/schemas";
import { requireDashboardAuth, isSameOriginStrict, parseBody } from "@/lib/api-utils";
import { writeNow } from "@/lib/integrations/write-store";
import { getTaskProfileOverview } from "@/lib/tasks/profiles";
import { integrationFailure, directOutcome } from "@/lib/integrations/write-api";

export async function POST(req: NextRequest) {
  const auth = requireDashboardAuth(req); if (!auth.ok) return auth.response;
  if (!isSameOriginStrict(req)) return NextResponse.json({ error: "Use a same-origin request." }, { status: 403 });
  const parsed = await parseBody(req, JiraCreateIssueSchema); if (!parsed.ok) return parsed.response;
  try {
    const input = parsed.data;
    const write = { action: "issue.create", provider: "jira", account: "default", projectKey: input.projectKey, title: input.summary, body: input.description, parentKey: input.parentKey ?? null, assignToMe: input.assignToMe ?? true, sprintId: input.sprintId ?? null } as const;

    const result = await writeNow(write, (getTaskProfileOverview().active ?? "default"), req.signal);
    const item = result.result.receipt?.item;
    return directOutcome(result, { key: item?.ref.id, url: item?.url }, 201);
  } catch (error) { return integrationFailure(error); }
}
