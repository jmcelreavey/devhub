import { SECRET_FIELD_MASK } from "./shared";

/**
 * Steps that stay "configured" as long as env vars exist — including a dead
 * Jira token. Next used to call goNext() and skip save() in that state.
 */
const ALWAYS_SAVE_STEP_IDS = new Set(["jira", "datadog", "agent"]);

export function shouldSaveBeforeNext(stepId: string, configured: boolean): boolean {
  if (ALWAYS_SAVE_STEP_IDS.has(stepId)) return true;
  return !configured;
}

export function jiraSetupSavePayload(
  form: { domain: string; email: string; apiToken: string },
  alreadyConfigured: boolean,
):
  | { ok: true; jira?: { domain?: string; email?: string; apiToken?: string } }
  | { ok: false; error: string } {
  const domain = form.domain.trim();
  const email = form.email.trim();
  const apiToken = form.apiToken.trim();
  const payload = {
    ...(domain && domain !== SECRET_FIELD_MASK ? { domain } : {}),
    ...(email && email !== SECRET_FIELD_MASK ? { email } : {}),
    ...(apiToken && apiToken !== SECRET_FIELD_MASK ? { apiToken } : {}),
  };
  if (!alreadyConfigured && !(payload.domain && payload.email && payload.apiToken)) {
    return { ok: false, error: "Enter your Jira site, email, and API token, or skip this step." };
  }
  return { ok: true, jira: Object.keys(payload).length > 0 ? payload : undefined };
}
