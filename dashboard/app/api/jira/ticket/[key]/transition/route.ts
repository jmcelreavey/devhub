import { NextRequest, NextResponse } from "next/server";
import { JiraTransitionSchema } from "@/lib/schemas";
import { requireDashboardAuth, isSameOriginStrict, parseBody } from "@/lib/api-utils";
import { requestWrite } from "@/lib/integrations/write-store";
import { alertProfile } from "@/lib/integrations/alert-worker";
import { integrationFailure } from "@/lib/integrations/write-api";

export async function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const auth = requireDashboardAuth(req); if (!auth.ok) return auth.response;
  if (!isSameOriginStrict(req)) return NextResponse.json({ error: "Review and confirm transitions in DevHub." }, { status: 403 });
  const parsed = await parseBody(req, JiraTransitionSchema); if (!parsed.ok) return parsed.response;
  try {
    const { key } = await params;
    const proposal = await requestWrite({ action: "issue.transition", provider: "jira", account: "default", ref: { provider: "jira", account: "default", kind: "issue", id: key }, transitionId: parsed.data.transitionId }, alertProfile());
    return NextResponse.json({ proposal, confirmationRequired: true }, { status: 202, headers: { "x-devhub-confirmation": "required" } });
  } catch (error) { return integrationFailure(error); }
}
