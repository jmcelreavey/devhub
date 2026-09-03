"use client";

/**
 * The client side of `/api/db`.
 *
 * Same shape as `components/repo-git/shared.tsx`: one place that knows the URL
 * layout and the failure codes, so panels don't each re-implement the parse
 * chain. The database API has its own set of recoverable failures — read-only,
 * confirmation needed, connection unavailable, timeout — and they need
 * different UI, not a shared error toast.
 */

import type { DbObjectDetail, DbNamespace, DbObjectSummary } from "@/lib/db/introspect-types";
import type { DbConnectionRef, DbPreflightCheck, DbResultSet } from "@/lib/db/types";
import type { DbStatementKind } from "@/lib/db/statement-kind";
import type { DbExportFormat } from "@/lib/db/export";

/* ─── Shared types ─── */

export type DbTabId = "data" | "structure" | "query" | "history";

export interface DbConnectionRow extends DbConnectionRef {
  /** A pooled connection is already open — the rail shows a live dot. */
  open?: boolean;
}

export interface DbConnectionsPayload {
  connections: DbConnectionRow[];
  errors: { providerId: string; message: string }[];
}

export interface DbSchemaPayload {
  engine: DbConnectionRef["engine"];
  namespaces: DbNamespace[];
  objects: DbObjectSummary[];
}

export interface DbRowIdentityInfo {
  columns: string[];
  source: "primary-key" | "unique-index" | "rowid" | "object-id";
  hidden: boolean;
  description: string;
}

export interface DbTablePayload extends DbObjectDetail {
  editable: boolean;
  identity: DbRowIdentityInfo | null;
  notEditableReason?: string;
}

export interface DbPlannedStatement {
  sql: string;
  kind: DbStatementKind;
  reason?: string;
}

export interface DbQueryPlan {
  kind: DbStatementKind;
  statements: DbPlannedStatement[];
  refusal?: { code: string; message: string };
  needsConfirmation: boolean;
  connection: { id: string; label: string; engine: DbConnectionRef["engine"] };
}

export interface DbQueryResult {
  connectionId: string;
  kind: DbStatementKind;
  results: DbResultSet[];
  statements: DbPlannedStatement[];
  durationMs: number;
}

/**
 * Reuses the server's own check type rather than restating it.
 *
 * The hand-written copy here silently lacked `remedy`, so the fix a provider
 * offered was invisible to the UI — the panel could only ever diagnose.
 */
export interface DbPreflightPayload {
  ok: boolean;
  checks: DbPreflightCheck[];
}

export interface DbHistoryRow {
  id: string;
  connectionId: string;
  connectionLabel: string;
  statement: string;
  kind: DbStatementKind;
  at: number;
  durationMs: number;
  ok: boolean;
  rowCount?: number;
  error?: string;
}

/* ─── URLs ─── */

export function dbApi(connectionId: string, suffix = ""): string {
  return `/api/db/${encodeURIComponent(connectionId)}${suffix}`;
}

/* ─── Requests ─── */

export async function fetchDbJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(await readDbError(res));
  return (await res.json()) as T;
}

export type DbActionFailure =
  /** The connection is read-only and the statement is not a read. */
  | { kind: "read-only"; message: string }
  /** A write against production: the user must type the connection label. */
  | { kind: "confirm"; message: string; connectionLabel: string }
  /** Credentials expired, VPN down, file missing — recoverable, and preflight explains it. */
  | { kind: "unavailable"; message: string }
  | { kind: "timeout"; message: string }
  | { kind: "error"; message: string; status: number };

export type DbActionResult<T> = { ok: true; json: T } | ({ ok: false } & DbActionFailure);

/**
 * POST and classify the failure.
 *
 * The codes come from `app/api/db/_shared.ts`. Branching on them rather than on
 * message text is what lets the query panel show a confirmation field for one
 * failure and a "check Tailscale" prompt for another.
 */
export async function postDbAction<T = Record<string, unknown>>(
  url: string,
  body: Record<string, unknown>,
  opts?: { signal?: AbortSignal; method?: "POST" | "PUT" | "DELETE" },
): Promise<DbActionResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts?.method ?? "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: opts?.signal,
    });
  } catch (err) {
    // A rejected fetch is the dashboard being unreachable, not a database error.
    if ((err as Error).name === "AbortError") throw err;
    return { ok: false, kind: "error", message: (err as Error).message, status: 0 };
  }

  if (res.ok) {
    const json = (await res.json().catch(() => ({}))) as T;
    return { ok: true, json };
  }

  const text = await res.text().catch(() => "");
  const payload = parseJson(text);
  const message = payload?.error ?? text ?? `Request failed (${res.status})`;

  switch (payload?.code) {
    case "read_only":
      return { ok: false, kind: "read-only", message };
    case "confirm_required":
      return {
        ok: false,
        kind: "confirm",
        message,
        connectionLabel: payload.connectionLabel ?? "",
      };
    case "unavailable":
      return { ok: false, kind: "unavailable", message };
    case "timeout":
      return { ok: false, kind: "timeout", message };
    default:
      return { ok: false, kind: "error", message, status: res.status };
  }
}

interface ErrorPayload {
  error?: string;
  code?: string;
  connectionLabel?: string;
}

function parseJson(text: string): ErrorPayload | null {
  try {
    return JSON.parse(text) as ErrorPayload;
  } catch {
    return null;
  }
}

async function readDbError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  return parseJson(text)?.error ?? text ?? `Request failed (${res.status})`;
}

/**
 * Export a result set as a file.
 *
 * Built as a blob and clicked rather than navigated to, because the request is
 * a POST carrying the statement — the query is often too long for a URL, and a
 * production query has no business sitting in browser history.
 */
export async function downloadDbExport(
  connectionId: string,
  body: { statement: string; format: DbExportFormat; name?: string; rowLimit?: number },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const res = await fetch(dbApi(connectionId, "/export"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) return { ok: false, message: await readDbError(res) };

  const blob = await res.blob();
  const filename =
    res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ??
    `export.${body.format}`;

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);

  return { ok: true };
}

/* ─── Display helpers ─── */

export function formatRowCount(count: number | undefined): string {
  if (count === undefined) return "—";
  if (count < 1_000) return String(count);
  if (count < 1_000_000) return `${(count / 1_000).toFixed(count < 10_000 ? 1 : 0)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  return `${(ms / 1_000).toFixed(2)}s`;
}

/** Badge tone for a statement kind, using the shared `badge-*` primitives. */
export function kindBadgeClass(kind: DbStatementKind): string {
  if (kind === "read") return "badge badge-muted";
  if (kind === "write") return "badge badge-warning";
  return "badge badge-danger";
}

/**
 * How long these credentials have left, and whether that is worth saying.
 *
 * Returns null well before expiry: a countdown that is always on stops being
 * information. It appears inside the last fifteen minutes, which is roughly the
 * window where starting a long query is a bad idea.
 */
export function credentialWarning(
  expiresAt: number | undefined,
  now = Date.now(),
): { text: string; tone: "warning" | "danger" } | null {
  if (!expiresAt) return null;
  const remaining = expiresAt - now;

  // Short on purpose. The rail is 260px and the connection's *name* is what you
  // are scanning for — "Credentials expired" crowded it out entirely, which
  // made the warning cost more than it was worth.
  if (remaining <= 0) return { text: "Expired", tone: "danger" };
  if (remaining > 15 * 60_000) return null;

  const minutes = Math.ceil(remaining / 60_000);
  return {
    text: `Expires in ${minutes}m`,
    tone: remaining <= 5 * 60_000 ? "danger" : "warning",
  };
}

/** Environment stripe colour, from the connection's tone. */
export function toneVar(tone: DbConnectionRef["tone"]): string {
  switch (tone) {
    case "danger":
      return "var(--danger)";
    case "warning":
      return "var(--warning)";
    case "accent":
      return "var(--accent)";
    default:
      return "var(--border)";
  }
}
