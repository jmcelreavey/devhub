import { z } from "zod";
import { getJiraMeta, invalidateJiraMetaCache, markdownToADF, normalizeTeamValueForWrite } from "@/lib/jira/client";
import { issueTypeForParent } from "@/lib/jira/issue-type";
import { invalidateJiraTicketsCache } from "@/lib/jira/tickets-cache";
import { invalidateSidebarCountsCache } from "@/lib/sidebar-counts-cache";
import { jiraConnection, jiraRequest, invalidateJiraTransitions } from "./jira";
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

export async function prepareJiraWrite(input: WriteInput, context: IntegrationContext): Promise<PreparedWrite> {
  if (input.provider !== "jira") throw new IntegrationError("unsupported", "Choose a Jira action.");
  const domain = jiraConnection(input.account).domain;
  if (input.action === "issue.assign-self") {
    const me = await currentUser(input.account, domain, context);
    return { destination: "https://" + domain + "/browse/" + input.ref.id, actor: me.displayName, summary: "Assign " + input.ref.id + " to " + me.displayName, details: { key: input.ref.id, assignee: me.displayName }, native: { domain, accountId: me.accountId, payload: { accountId: me.accountId } } };
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
  if (input.provider !== "jira" || !context.requestId) throw new IntegrationError("unsupported", "A Jira action is required.");
  try {
    if (input.action === "issue.assign-self") {
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
