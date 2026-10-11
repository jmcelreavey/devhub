import { z } from "zod";
import { getJiraMeta, invalidateJiraMetaCache, markdownToADF, normalizeTeamValueForWrite } from "@/lib/jira/client";
import { issueTypeForParent } from "@/lib/jira/issue-type";
import { invalidateJiraTicketsCache } from "@/lib/jira/tickets-cache";
import { invalidateSidebarCountsCache } from "@/lib/sidebar-counts-cache";
import { jiraConnection, jiraRequest } from "./jira";
import { IntegrationError, type IntegrationContext } from "./types";
import type { WriteInput, PreparedWrite, WriteContext, WriteReceipt } from "./write-types";

export async function prepareJiraWrite(input: WriteInput, context: IntegrationContext): Promise<PreparedWrite> {
  if (input.provider !== "jira") throw new IntegrationError("unsupported", "Choose a Jira action.");
  const me = z.object({ accountId: z.string(), displayName: z.string() }).parse(await jiraRequest(input.account, "/myself", context));
  const domain = jiraConnection(input.account).domain;
  const actor = me.displayName + " (" + me.accountId + ")";
  if (input.action === "issue.transition") {
    const issue = z.object({ fields: z.object({ summary: z.string(), updated: z.string(), status: z.object({ id: z.string(), name: z.string() }) }) }).parse(await jiraRequest(input.account, "/issue/" + encodeURIComponent(input.ref.id) + "?fields=summary,status,updated", context));
    const available = z.object({ transitions: z.array(z.object({ id: z.string(), name: z.string(), to: z.object({ name: z.string() }).optional() })) }).parse(await jiraRequest(input.account, "/issue/" + encodeURIComponent(input.ref.id) + "/transitions", context));
    const transition = available.transitions.find((t) => t.id === input.transitionId);
    if (!transition) throw new IntegrationError("conflict", "This transition is no longer available. Refresh the ticket.");
    return { destination: "https://" + domain + "/browse/" + input.ref.id, actor, summary: "Move " + input.ref.id + " to " + (transition.to?.name ?? transition.name),
      details: { ticket: issue.fields.summary, from: issue.fields.status.name, transition: transition.name, transitionId: transition.id, to: transition.to?.name ?? transition.name },
      native: { domain, accountId: me.accountId, revision: issue.fields.updated, statusId: issue.fields.status.id, payload: { transition: { id: input.transitionId } } } };
  }
  const parent = input.parentKey ? z.object({ fields: z.object({ issuetype: z.object({ name: z.string() }), updated: z.string() }) }).parse(await jiraRequest(input.account, "/issue/" + input.parentKey + "?fields=issuetype,updated", context)) : null;
  const issueType = parent ? issueTypeForParent(parent.fields.issuetype.name) : "Task";
  const fields: Record<string, unknown> = { project: { key: input.projectKey }, issuetype: { name: issueType }, summary: input.title, description: markdownToADF(input.body) };
  if (input.parentKey) fields.parent = { key: input.parentKey };
  if (input.assignToMe) fields.assignee = { accountId: me.accountId };
  let team: string | null = null;
  const isSubtask = issueType.toLowerCase().replace(/\s+/g, "") === "sub-task";
  if (input.account === "default") {
    const meta = await getJiraMeta(input.projectKey, input.parentKey ?? undefined);
    if (!isSubtask && input.sprintId && meta.sprintFieldId) fields[meta.sprintFieldId] = input.sprintId;
    if (!isSubtask && meta.teamFieldId && meta.teamValue != null) { fields[meta.teamFieldId] = normalizeTeamValueForWrite(meta.teamValue); team = meta.teamLabel; }
  } else if (input.sprintId) {
    throw new IntegrationError("unsupported", "Sprint inheritance currently uses the default Jira account. Omit the sprint for a named account.");
  }
  return { destination: "https://" + domain + "/plugins/servlet/project-config/" + input.projectKey, actor, summary: "Create " + issueType + " in " + input.projectKey,
    details: { project: input.projectKey, title: input.title, description: input.body, issueType, parent: input.parentKey, assignee: input.assignToMe ? actor : "Project default", sprintId: isSubtask ? null : input.sprintId, team },
    native: { domain, accountId: me.accountId, parentRevision: parent?.fields.updated ?? null, payload: { fields } } };
}
export async function executeJiraWrite(input: WriteInput, prepared: PreparedWrite, context: WriteContext): Promise<WriteReceipt> {
  if (input.provider !== "jira" || !context.approvalId) throw new IntegrationError("unsupported", "An approved Jira action is required.");
  try {
    if (input.action === "issue.transition") {
      await jiraRequest(input.account, "/issue/" + encodeURIComponent(input.ref.id) + "/transitions", context, prepared.native.payload);
      return { detail: prepared.summary };
    }
    const result = z.object({ key: z.string() }).parse(await jiraRequest(input.account, "/issue", context, prepared.native.payload));
    return { detail: "Created " + result.key, item: { ref: { provider: "jira", account: input.account, kind: "issue", id: result.key }, title: input.title, url: "https://" + prepared.native.domain + "/browse/" + result.key } };
  } catch (error) { invalidateJiraMetaCache(); throw error; }
  finally { invalidateJiraTicketsCache(); invalidateSidebarCountsCache(); }
}
