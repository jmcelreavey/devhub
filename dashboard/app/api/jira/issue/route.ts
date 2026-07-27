import { NextResponse } from "next/server";
import { createIssue, getJiraMeta, getTicket } from "@/lib/jira/client";
import { issueTypeForParent } from "@/lib/jira/issue-type";
import { JiraCreateIssueSchema } from "@/lib/schemas";
import { withErrorHandler, parseBody, notConfigured } from "@/lib/api-utils";
import { invalidateJiraTicketsCache } from "@/lib/jira/tickets-cache";
import { invalidateSidebarCountsCache } from "@/lib/sidebar-counts-cache";

/**
 * Create a Jira issue (Task by default) under an optional parent.
 * Sprint field, Team field, and the inherited Team value are resolved
 * server-side from the project's board + a reference ticket (the parent).
 */
export const POST = withErrorHandler(async (req: Request) => {
  if (!process.env.JIRA_DOMAIN) {
    return notConfigured("Jira");
  }

  const parsed = await parseBody(req, JiraCreateIssueSchema);
  if (!parsed.ok) return parsed.response;
  const input = parsed.data;

  // Resolve sprint/team field ids + Team value server-side, inheriting Team
  // from the parent ticket when one is chosen.
  const meta = await getJiraMeta(input.projectKey, input.parentKey ?? undefined);
  const parentTicket = input.parentKey ? await getTicket(input.parentKey).catch(() => null) : null;
  const issuetypeName = input.issuetypeName || (input.parentKey ? issueTypeForParent(parentTicket?.issuetype) : "Task");

  const created = await createIssue({
    projectKey: input.projectKey,
    summary: input.summary,
    description: input.description,
    parentKey: input.parentKey ?? null,
    issuetypeName,
    assignToMe: input.assignToMe ?? true,
    sprintId: input.sprintId ?? null,
    sprintFieldId: meta.sprintFieldId,
    teamFieldId: meta.teamFieldId,
    teamValue: meta.teamValue,
  });

  invalidateJiraTicketsCache();
  invalidateSidebarCountsCache();
  return NextResponse.json(created, { status: 201 });
}, "jira.issue.create");
