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
export async function jiraRequest(account: string, endpoint: string, context: IntegrationContext, body?: unknown, method?: "PUT") {
  const client = jiraConnection(account);
  return providerJson(apiBase(client) + endpoint, { headers: jsonHeaders(client), method: method ?? (body ? "POST" : "GET"), body: body ? JSON.stringify(body) : undefined }, context.signal);
}
function item(account: string, raw: z.infer<typeof IssueSchema>): IntegrationItem {
  return { ref: { provider: "jira", account, kind: "issue", id: raw.key }, title: raw.fields.summary, url: "https://" + jiraConnection(account).domain + "/browse/" + raw.key, revision: raw.fields.updated, status: { id: raw.fields.status.id, label: raw.fields.status.name, category: raw.fields.status.statusCategory?.key } };
}
const TRANSITIONS_TTL_MS = 20_000;
const transitionCache = new Map<string, { at: number; value: Array<{ id: string; label: string; statusId?: string; statusLabel?: string }> }>();
/** Called after a write: the list that was valid before the move no longer is. */
export function invalidateJiraTransitions(account: string, key: string) { transitionCache.delete(account + ":" + key); }
export function clearJiraTransitionCache() { transitionCache.clear(); }
export const jiraProvider: IntegrationProvider = {
  id: "jira", apiVersion: 1, label: "Jira",
  capabilities: ["issue.read", "issue.search", "issue.transitions", "issue.create", "issue.transition"],
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
