import { apiBase, getResolvedJiraEnv, jsonHeaders, type ResolvedJira } from "@/lib/jira/env";

export interface JiraCheckResult {
  ok: boolean;
  code: string;
  message: string;
}

/**
 * Probe Jira `/myself` with form values, falling back to the saved env.
 * Masked/blank fields are omitted by the client so a connected step can
 * re-check without re-pasting every field.
 */
export async function checkJiraConnection(input: {
  domain?: string;
  email?: string;
  apiToken?: string;
}): Promise<JiraCheckResult> {
  const saved = getResolvedJiraEnv();
  const domain = input.domain?.trim() || saved?.domain;
  const email = input.email?.trim() || saved?.email;
  const apiToken = input.apiToken?.trim() || saved?.apiToken;
  if (!(domain && email && apiToken)) {
    return {
      ok: false,
      code: "missing_credentials",
      message:
        "Jira domain, email, and API token are required. Enter them above, or set JIRA_DOMAIN, JIRA_EMAIL, and JIRA_API_TOKEN.",
    };
  }

  const j: ResolvedJira = { domain, email, apiToken };
  try {
    const res = await fetch(`${apiBase(j)}/myself`, { headers: jsonHeaders(j) });
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        code: "auth_failed",
        message: `Jira authentication failed (HTTP ${res.status}). Mint a new API token and paste it above.`,
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        code: "upstream_error",
        message: `Jira returned HTTP ${res.status}.`,
      };
    }
    return { ok: true, code: "connected", message: "Connected to Jira successfully." };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return {
      ok: false,
      code: "network_error",
      message: `Could not reach Jira: ${msg}`,
    };
  }
}
