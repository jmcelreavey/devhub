/**
 * Resolve who is currently on call from a Datadog On-Call schedule, and decide
 * whether *you* (the configured email) are carrying the pager. Pure helpers are
 * split out from the server fetch so they stay unit-testable.
 * @see https://docs.datadoghq.com/api/latest/on-call/
 */

export interface OncallUser {
  email: string;
  name?: string;
}

export type OncallStatus =
  | { ok: true; onCall: boolean; users: OncallUser[]; checkedAt: string }
  | {
      ok: false;
      code: "not_configured" | "needs_application_key" | "needs_email" | "upstream";
      message: string;
    };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * Extract on-call users from a `GET /schedules/{id}/on-call?include=users`
 * response. The on-call user(s) arrive as `users`-typed resources in the
 * `included` array; shapes vary, so read defensively.
 */
export function extractOncallUsers(raw: unknown): OncallUser[] {
  const root = asRecord(raw);
  const included = Array.isArray(root.included) ? root.included : [];
  const users: OncallUser[] = [];
  for (const entry of included) {
    const resource = asRecord(entry);
    if (resource.type !== "users") continue;
    const attributes = asRecord(resource.attributes);
    const email = typeof attributes.email === "string" ? attributes.email.trim() : "";
    if (!email) continue;
    const name =
      (typeof attributes.name === "string" && attributes.name) ||
      (typeof attributes.handle === "string" && attributes.handle) ||
      undefined;
    users.push({ email, name });
  }
  return users;
}

/** Case-insensitive match of the configured email against the on-call roster. */
export function emailMatches(users: OncallUser[], myEmail: string): boolean {
  const mine = myEmail.trim().toLowerCase();
  if (!mine) return false;
  return users.some((u) => u.email.toLowerCase() === mine);
}

/** Split a `DATADOG_ONCALL_SCHEDULE_ID` override (comma-separated) into ids. */
export function parseScheduleIds(value: string | undefined | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Collect schedule ids from a `GET /on-call/schedules` list response. */
export function extractScheduleIds(raw: unknown): string[] {
  const root = asRecord(raw);
  const data = Array.isArray(root.data) ? root.data : [];
  const ids: string[] = [];
  for (const entry of data) {
    const id = asRecord(entry).id;
    if (typeof id === "string" && id) ids.push(id);
  }
  return ids;
}
