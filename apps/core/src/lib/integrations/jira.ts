import { jiraConnection, jiraRequest, transitionCache, TRANSITIONS_TTL_MS } from "./jira-transport";
export { jiraConnection, jiraRequest, invalidateJiraTransitions, clearJiraTransitionCache } from "./jira-transport";
import { z } from "zod";
import { prepareJiraWrite, executeJiraWrite } from "./jira-write";
import { accountsFor } from "./accounts";
import { IntegrationError, type IntegrationItem, type IntegrationProvider, type IntegrationRef } from "./types";
const IssueSchema = z.object({ key: z.string(), fields: z.object({ summary: z.string(), updated: z.string(), status: z.object({ id: z.string(), name: z.string(), statusCategory: z.object({ key: z.string() }).optional() }) }) });
function key(ref: IntegrationRef) {
  if (ref.kind !== "issue" || !/^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/.test(ref.id)) throw new IntegrationError("invalid", "Choose a native Jira issue key.");
  return ref.id;
}
function item(account: string, raw: z.infer<typeof IssueSchema>): IntegrationItem {
  return { ref: { provider: "jira", account, kind: "issue", id: raw.key }, title: raw.fields.summary, url: "https://" + jiraConnection(account).domain + "/browse/" + raw.key, revision: raw.fields.updated, status: { id: raw.fields.status.id, label: raw.fields.status.name, category: raw.fields.status.statusCategory?.key } };
}
export const jiraProvider: IntegrationProvider = {
  id: "jira", apiVersion: 1, label: "Jira",
  capabilities: ["issue.read", "issue.search", "issue.transitions", "issue.create", "issue.transition", "issue.assign", "issue.assign-self"],
  prepareWrite: prepareJiraWrite,
  executeWrite: executeJiraWrite,
  accounts: () => accountsFor("jira"),
  async get(ref, context) { return item(ref.account, IssueSchema.parse(await jiraRequest(ref.account, "/issue/" + key(ref) + "?fields=summary,status,updated", context))); },
  async transitions(ref, context) {
    // The picker, hover prefetch and the MCP listing all ask for the same list within seconds.
    const cacheKey = ref.account + ":" + key(ref);
    const hit = transitionCache.get(cacheKey);
    if (hit && Date.now() - hit.at < TRANSITIONS_TTL_MS) return hit.value;
    const result = z.object({ transitions: z.array(z.object({ id: z.string(), name: z.string(), to: z.object({ id: z.string(), name: z.string().optional() }).optional() })) }).parse(await jiraRequest(ref.account, "/issue/" + key(ref) + "/transitions", context));
    const value = result.transitions.map((transition) => ({ id: transition.id, label: transition.name, statusId: transition.to?.id, statusLabel: transition.to?.name }));
    transitionCache.set(cacheKey, { at: Date.now(), value });
    return value;
  },
};
