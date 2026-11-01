import { z } from "zod";
import { getJiraMeta, invalidateJiraMetaCache, markdownToADF, normalizeTeamValueForWrite } from "../jira/client";
import { issueTypeForParent } from "../../../../../packages/shared/ui-lib/jira/issue-type";
import { invalidateJiraTicketsCache } from "../jira/tickets-cache";
import { invalidateSidebarCountsCache } from "../activity/sidebar-counts-cache";
import { jiraConnection, jiraRequest, invalidateJiraTransitions } from "./jira-transport";
import { IntegrationError, type IntegrationContext } from "./types";
import type { WriteInput, PreparedWrite, WriteContext, WriteReceipt } from "./write-types";

const TransitionIssue = z.object({
  fields: z.object({ summary: z.string(), updated: z.string(), status: z.object({ id: z.string(), name: z.string() }) }),
  transitions: z.array(z.object({ id: z.string(), name: z.string(), to: z.object({ id: z.string(), name: z.string() }).optional() })),
});
const Me = z.object({ accountId: z.string(), displayName: z.string() });
const ACTOR_TTL_MS = 5 * 60_000;
const actors = new Map<string, { at: number; me: z.infer<typeof Me> }>();
/** Who the account authenticates as barely changes, and every prepare used to pay a round trip for it. */
async function currentUser(account: string, domain: string, context: IntegrationContext) {
  const key = account + "@" + domain;
  const hit = actors.get(key);
  if (hit && Date.now() - hit.at < ACTOR_TTL_MS) return hit.me;
  const me = Me.parse(await jiraRequest(account, "/myself", context));
  actors.set(key, { at: Date.now(), me });
  return me;
}
export function clearJiraActorCache() { actors.clear(); }
const JiraUser = z.object({ accountId: z.string(), displayName: z.string().default(""), emailAddress: z.string().optional(), accountType: z.string().optional(), active: z.boolean().optional() });
const AssigneeIssue = z.object({ fields: z.object({ summary: z.string().default(""), assignee: JiraUser.nullable().optional() }) });
/** Jira Cloud account ids: "557058:uuid", "712020:uuid" or a 24-char hex id. */
const ACCOUNT_ID = /^(?:[0-9]+:[0-9a-f-]{36}|[0-9a-f]{24})$/i;
async function resolveAssignee(account: string, domain: string, who: string, context: IntegrationContext) {
  const value = who.trim();
  if (/^(?:me|self|myself)$/i.test(value)) { const me = await currentUser(account, domain, context); return { accountId: me.accountId, displayName: me.displayName }; }
  if (ACCOUNT_ID.test(value)) return JiraUser.parse(await jiraRequest(account, "/user?accountId=" + encodeURIComponent(value), context));
  const found = z.array(JiraUser).parse(await jiraRequest(account, "/user/search?query=" + encodeURIComponent(value) + "&maxResults=10", context))
    .filter((user) => user.active !== false && (user.accountType ?? "atlassian") === "atlassian");
  const lower = value.toLowerCase();
  const exact = found.filter((user) => user.emailAddress?.toLowerCase() === lower || user.displayName.toLowerCase() === lower);
  const pick = exact.length === 1 ? exact : found;
  if (pick.length === 1) return pick[0];
  if (pick.length === 0) throw new IntegrationError("conflict", "No active Jira user matches \"" + value + "\".");
  throw new IntegrationError("conflict", "\"" + value + "\" matches " + pick.length + " Jira users: " + pick.slice(0, 5).map((user) => user.displayName + " (" + user.accountId + ")").join(", ") + ". Pass the accountId.");
}

export async function prepareJiraWrite(input: WriteInput, context: IntegrationContext): Promise<PreparedWrite> {
  if (input.action === "pr.create" || input.action === "pr.update" || input.action === "pr.publish") throw new IntegrationError("unsupported", "Choose a Jira action.");
  if (input.provider !== "jira") throw new IntegrationError("unsupported", "Choose a Jira action.");
  const domain = jiraConnection(input.account).domain;
  if (input.action === "issue.assign-self") {
    const me = await currentUser(input.account, domain, context);
    return { destination: "https://" + domain + "/browse/" + input.ref.id, actor: me.displayName, summary: "Assign " + input.ref.id + " to " + me.displayName, details: { key: input.ref.id, assignee: me.displayName }, native: { domain, accountId: me.accountId, payload: { accountId: me.accountId } } };
  }
  if (input.action === "issue.assign") {
    const [target, issue] = await Promise.all([
      resolveAssignee(input.account, domain, input.assignee, context),
      jiraRequest(input.account, "/issue/" + encodeURIComponent(input.ref.id) + "?fields=summary,assignee", context).then((raw) => AssigneeIssue.parse(raw)),
    ]);
    const from = issue.fields.assignee ?? null;
    return { destination: "https://" + domain + "/browse/" + input.ref.id, actor: target.displayName, summary: "Assign " + input.ref.id + " to " + target.displayName,
      details: { key: input.ref.id, ticket: issue.fields.summary, assignee: target.displayName, assigneeAccountId: target.accountId, from: from?.displayName ?? null, fromAccountId: from?.accountId ?? null },
      native: { domain, accountId: target.accountId, payload: { accountId: target.accountId } } };
  }
  if (input.action === "issue.transition") {
    // One issue read carries the available transitions (expand), so the actor and the issue are the only reads, in parallel.
    const [me, issue] = await Promise.all([
      currentUser(input.account, domain, context),
      jiraRequest(input.account, "/issue/" + encodeURIComponent(input.ref.id) + "?fields=summary,status,updated&expand=transitions", context).then((raw) => TransitionIssue.parse(raw)),
    ]);
    const transition = issue.transitions.find((t) => t.id === input.transitionId);
    if (!transition) throw new IntegrationError("conflict", "This transition is no longer available. Refresh the ticket.");
    const to = transition.to ?? { id: null, name: transition.name };
    return { destination: "https://" + domain + "/browse/" + input.ref.id, actor: me.displayName + " (" + me.accountId + ")", summary: "Move " + input.ref.id + " to " + to.name,
      details: { ticket: issue.fields.summary, from: issue.fields.status.name, transition: transition.name, transitionId: transition.id, to: to.name, key: input.ref.id, fromStatusId: issue.fields.status.id, toStatusId: to.id },
      native: { domain, accountId: me.accountId, revision: issue.fields.updated, statusId: issue.fields.status.id, payload: { transition: { id: input.transitionId } } } };
  }
  const me = await currentUser(input.account, domain, context);
  const actor = me.displayName + " (" + me.accountId + ")";
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
  if (input.action === "pr.create" || input.action === "pr.update" || input.action === "pr.publish") throw new IntegrationError("unsupported", "Choose a Jira action.");
  if (input.provider !== "jira" || !context.requestId) throw new IntegrationError("unsupported", "A Jira action is required.");
  try {
    if (input.action === "issue.assign-self" || input.action === "issue.assign") {
      await jiraRequest(input.account, "/issue/" + encodeURIComponent(input.ref.id) + "/assignee", context, prepared.native.payload, "PUT");
      return { detail: prepared.summary };
    }
    if (input.action === "issue.transition") {
      await jiraRequest(input.account, "/issue/" + encodeURIComponent(input.ref.id) + "/transitions", context, prepared.native.payload);
      return { detail: prepared.summary };
    }
    const result = z.object({ key: z.string() }).parse(await jiraRequest(input.account, "/issue", context, prepared.native.payload));
    return { detail: "Created " + result.key, item: { ref: { provider: "jira", account: input.account, kind: "issue", id: result.key }, title: input.title, url: "https://" + prepared.native.domain + "/browse/" + result.key } };
  } catch (error) { invalidateJiraMetaCache(); throw error; }
  finally { invalidateJiraTicketsCache(); invalidateSidebarCountsCache(); if (input.action === "issue.transition") invalidateJiraTransitions(input.account, input.ref.id); }
}
