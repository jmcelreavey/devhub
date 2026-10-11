import { z } from "zod";
import { prepareJiraWrite, executeJiraWrite } from "./jira-write";
import { getResolvedJiraEnv, apiBase, jsonHeaders } from "@/lib/jira/env";
import { accountConfig, accountsFor, credential } from "./accounts";
import { providerJson } from "./http";
import { IntegrationError, type IntegrationContext, type IntegrationItem, type IntegrationProvider, type IntegrationRef } from "./types";
const IssueSchema = z.object({ key: z.string(), fields: z.object({ summary: z.string(), updated: z.string(), status: z.object({ id: z.string(), name: z.string(), statusCategory: z.object({ key: z.string() }).optional() }) }) });
export function jiraConnection(account: string) {
  if (account === "default") {
    const existing = getResolvedJiraEnv();
    if (!existing) throw new IntegrationError("auth", "Configure Jira in Setup.");
    return existing;
  }
  const config = accountConfig("jira", account);
  if (!config.domain || !config.emailRef) throw new IntegrationError("invalid", "This Jira account is incomplete.");
  return { domain: config.domain, email: credential(config.emailRef), apiToken: credential(config.tokenRef) };
}
function key(ref: IntegrationRef) {
  if (ref.kind !== "issue" || !/^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/.test(ref.id)) throw new IntegrationError("invalid", "Choose a native Jira issue key.");
  return ref.id;
}
export async function jiraRequest(account: string, endpoint: string, context: IntegrationContext, body?: unknown) {
  const client = jiraConnection(account);
  return providerJson(apiBase(client) + endpoint, { headers: jsonHeaders(client), method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined }, context.signal);
}
function item(account: string, raw: z.infer<typeof IssueSchema>): IntegrationItem {
  return { ref: { provider: "jira", account, kind: "issue", id: raw.key }, title: raw.fields.summary, url: "https://" + jiraConnection(account).domain + "/browse/" + raw.key, revision: raw.fields.updated, status: { id: raw.fields.status.id, label: raw.fields.status.name, category: raw.fields.status.statusCategory?.key } };
}
export const jiraProvider: IntegrationProvider = {
  id: "jira", apiVersion: 1, label: "Jira",
  capabilities: ["issue.read", "issue.search", "issue.transitions", "issue.create", "issue.transition"],
  prepareWrite: prepareJiraWrite,
  executeWrite: executeJiraWrite,
  accounts: () => accountsFor("jira"),
  async get(ref, context) { return item(ref.account, IssueSchema.parse(await jiraRequest(ref.account, "/issue/" + key(ref) + "?fields=summary,status,updated", context))); },
  async search(account, kind, query, cursor, context) {
    if (kind !== "issue") throw new IntegrationError("unsupported", "Jira supports issue search.");
    // Jira can return an empty search for bad credentials; check auth first.
    await jiraRequest(account, "/myself", context);
    const result = z.object({ issues: z.array(IssueSchema), nextPageToken: z.string().optional(), isLast: z.boolean().optional() }).parse(await jiraRequest(account, "/search/jql", context, { jql: query || "assignee = currentUser() ORDER BY updated DESC", fields: ["summary", "status", "updated"], maxResults: 30, ...(cursor ? { nextPageToken: cursor } : {}) }));
    return { items: result.issues.map((raw) => item(account, raw)), next: result.isLast ? undefined : result.nextPageToken };
  },
  async transitions(ref, context) {
    const result = z.object({ transitions: z.array(z.object({ id: z.string(), name: z.string(), to: z.object({ id: z.string(), name: z.string().optional() }).optional() })) }).parse(await jiraRequest(ref.account, "/issue/" + key(ref) + "/transitions", context));
    return result.transitions.map((transition) => ({ id: transition.id, label: transition.name, statusId: transition.to?.id, statusLabel: transition.to?.name }));
  },
};
