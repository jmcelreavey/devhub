import { getResolvedJiraEnv, apiBase, jsonHeaders } from "../jira/env";
import { accountConfig, credential } from "./accounts";
import { providerJson } from "./http";
import { IntegrationError, type IntegrationContext } from "./types";

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
export async function jiraRequest(account: string, endpoint: string, context: IntegrationContext, body?: unknown, method?: "PUT") {
  const client = jiraConnection(account);
  return providerJson(apiBase(client) + endpoint, { headers: jsonHeaders(client), method: method ?? (body ? "POST" : "GET"), body: body ? JSON.stringify(body) : undefined }, context.signal);
}
export const TRANSITIONS_TTL_MS = 20_000;
export const transitionCache = new Map<string, { at: number; value: Array<{ id: string; label: string; statusId?: string; statusLabel?: string }> }>();
/** Called after a write: the list that was valid before the move no longer is. */
export function invalidateJiraTransitions(account: string, key: string) { transitionCache.delete(account + ":" + key); }
export function clearJiraTransitionCache() { transitionCache.clear(); }
