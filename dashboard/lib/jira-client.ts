import { readDashboardEnvLocalFile, resolveEnvValue } from "@/lib/dashboard-env-local";

export interface JiraTicket {
  key: string;
  summary: string;
  status: string;
  priority: string;
  issuetype: string;
  project: string;
  projectKey: string;
  url: string;
  /** ISO 8601 from Jira `updated` — closest standard signal for “recently active / assigned work”. */
  updatedAt: string;
}

/** Standup slice: still assigned to you, with `updated` in the given local calendar window. */
export interface JiraStandupTicket extends JiraTicket {
  /** e.g. Done, Won't Do, or Unresolved when still open. */
  resolutionName: string;
}

interface JiraNamedField {
  name?: string;
  key?: string;
}

interface JiraIssueFields {
  summary?: string;
  status?: JiraNamedField;
  priority?: JiraNamedField;
  issuetype?: JiraNamedField;
  project?: JiraNamedField;
  updated?: string;
  resolution?: JiraNamedField | null;
}

interface JiraIssue {
  key: string;
  fields: JiraIssueFields;
}

interface JiraSearchResponse {
  issues?: JiraIssue[];
}

interface ResolvedJira {
  domain: string;
  email: string;
  apiToken: string;
}

function getResolvedJiraEnv(): ResolvedJira | null {
  const { overrides } = readDashboardEnvLocalFile();
  const domain = resolveEnvValue("JIRA_DOMAIN", overrides);
  const email = resolveEnvValue("JIRA_EMAIL", overrides);
  const apiToken = resolveEnvValue("JIRA_API_TOKEN", overrides);
  if (!(domain && email && apiToken)) return null;
  return { domain, email, apiToken };
}

function authHeader(j: ResolvedJira): string {
  return "Basic " + Buffer.from(`${j.email}:${j.apiToken}`).toString("base64");
}

function apiBase(j: ResolvedJira): string {
  return `https://${j.domain}/rest/api/3`;
}

export async function getMyTickets(): Promise<JiraTicket[]> {
  const j = getResolvedJiraEnv();
  if (!j) return [];

  const res = await fetch(`${apiBase(j)}/search/jql`, {
    method: "POST",
    headers: {
      Authorization: authHeader(j),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jql: "assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC",
      fields: ["summary", "status", "priority", "issuetype", "project", "updated"],
      maxResults: 100,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira API ${res.status}: ${text}`);
  }

  const data = (await res.json()) as JiraSearchResponse;

  return (data.issues ?? []).map((issue) => ({
    key: issue.key,
    summary: issue.fields.summary ?? "",
    status: issue.fields.status?.name ?? "Unknown",
    priority: issue.fields.priority?.name ?? "None",
    issuetype: issue.fields.issuetype?.name ?? "Task",
    project: issue.fields.project?.name ?? "",
    projectKey: issue.fields.project?.key ?? "",
    url: `https://${j.domain}/browse/${issue.key}`,
    updatedAt: issue.fields.updated ?? "",
  }));
}

/**
 * Tickets **currently assigned to you** whose `updated` timestamp falls in
 * `[localStartYmd startTime, localEndYmd endTime]` in Jira's date interpretation.
 * Includes status changes and edits by anyone, not only your actions.
 */
export async function getMyAssignedTicketsTouchedInRange(
  localStartYmd: string,
  localEndYmd: string,
  startTime = "00:00",
  endTime = "23:59",
): Promise<JiraStandupTicket[]> {
  const j = getResolvedJiraEnv();
  if (!j) return [];

  const jql = `assignee = currentUser() AND updated >= "${localStartYmd} ${startTime}" AND updated <= "${localEndYmd} ${endTime}" ORDER BY updated DESC`;

  const res = await fetch(`${apiBase(j)}/search/jql`, {
    method: "POST",
    headers: {
      Authorization: authHeader(j),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jql,
      fields: ["summary", "status", "priority", "issuetype", "project", "updated", "resolution"],
      maxResults: 50,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira API ${res.status}: ${text}`);
  }

  const data = (await res.json()) as JiraSearchResponse;

  return (data.issues ?? []).map((issue) => {
    const resField = issue.fields.resolution;
    const resolutionName =
      resField && typeof resField === "object" && "name" in resField && resField.name
        ? String(resField.name)
        : "Unresolved";
    return {
      key: issue.key,
      summary: issue.fields.summary ?? "",
      status: issue.fields.status?.name ?? "Unknown",
      priority: issue.fields.priority?.name ?? "None",
      issuetype: issue.fields.issuetype?.name ?? "Task",
      project: issue.fields.project?.name ?? "",
      projectKey: issue.fields.project?.key ?? "",
      url: `https://${j.domain}/browse/${issue.key}`,
      updatedAt: issue.fields.updated ?? "",
      resolutionName,
    };
  });
}

export async function getTicket(key: string): Promise<{ status: { name: string } } | null> {
  const j = getResolvedJiraEnv();
  if (!j) return null;

  const res = await fetch(`${apiBase(j)}/issue/${key}?fields=status`, {
    headers: {
      Authorization: authHeader(j),
      Accept: "application/json",
    },
  });

  if (!res.ok) return null;
  const data = (await res.json()) as { fields?: { status?: { name?: string } } };
  return { status: { name: data.fields?.status?.name ?? "Unknown" } };
}
