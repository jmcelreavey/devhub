import { readDashboardEnvLocalFile, resolveEnvValue } from "@/lib/dashboard-env-local";

export interface ResolvedJira {
  domain: string;
  email: string;
  apiToken: string;
}

export function getResolvedJiraEnv(): ResolvedJira | null {
  const { overrides } = readDashboardEnvLocalFile();
  const domain = resolveEnvValue("JIRA_DOMAIN", overrides);
  const email = resolveEnvValue("JIRA_EMAIL", overrides);
  const apiToken = resolveEnvValue("JIRA_API_TOKEN", overrides);
  if (!(domain && email && apiToken)) return null;
  return { domain, email, apiToken };
}

export function authHeader(j: ResolvedJira): string {
  return "Basic " + Buffer.from(`${j.email}:${j.apiToken}`).toString("base64");
}

export function apiBase(j: ResolvedJira): string {
  return `https://${j.domain}/rest/api/3`;
}

export function jsonHeaders(j: ResolvedJira): Record<string, string> {
  return {
    Authorization: authHeader(j),
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}
