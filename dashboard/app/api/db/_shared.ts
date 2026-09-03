/**
 * Shared kit for the `/api/db` routes.
 *
 * Two things that differ from the git routes on purpose:
 *
 * 1. **Every route is authenticated, GET included.** `/api/repos/*` is gated
 *    only by `resolveScannedRepo`, which is defensible when the payload is a
 *    local diff. It is not defensible when the payload is rows out of a
 *    production database, so `requireDashboardAuth` runs first here.
 * 2. **Resolving a connection is a network operation.** `withScannedRepo` is a
 *    path check and cannot fail slowly; `withConnection` mints IAM tokens and
 *    opens sockets, so it is async and its failures are user-facing prose.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireDashboardAuth } from "@/lib/api-utils";
import {
  DbConnectionNotFoundError,
  DbConnectionUnavailableError,
} from "@/lib/db/provider";
import { findDbConnection } from "@/lib/db/registry";
import { isTimeoutError } from "@/lib/db/pool";
import type { DbConnectionRef } from "@/lib/db/types";

export type ConnectionParams = { params: Promise<{ id: string }> };

/**
 * Machine-readable failure codes. The client branches on these rather than on
 * message text, the same contract `postGitAction` relies on.
 */
export type DbErrorCode =
  | "read_only"
  | "confirm_required"
  | "unavailable"
  | "not_found"
  | "timeout"
  | "no_row_identity";

export function dbError(
  message: string,
  status: number,
  code?: DbErrorCode,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ error: message, ...(code ? { code } : {}), ...extra }, { status });
}

/** Auth first, always. Returns the response to send when the caller fails it. */
export function requireAuth(req: NextRequest): NextResponse | null {
  const auth = requireDashboardAuth(req);
  return auth.ok ? null : auth.response;
}

/**
 * Look up a connection by id.
 *
 * Deliberately returns the *ref*, not the resolved credentials — a route that
 * only needs to know the access mode must not cause a token mint, and nothing
 * downstream of a route handler should be holding a password.
 */
export async function withConnection(
  id: string,
): Promise<{ ok: true; connection: DbConnectionRef } | { ok: false; response: NextResponse }> {
  const connection = await findDbConnection(id);
  if (!connection) {
    return { ok: false, response: dbError(`No database connection with id '${id}'.`, 404, "not_found") };
  }
  if (connection.unavailable) {
    return { ok: false, response: dbError(connection.unavailable, 409, "unavailable") };
  }
  return { ok: true, connection };
}

/**
 * Turn a thrown driver or provider error into the right status.
 *
 * Raw driver text is rarely actionable ("connection terminated unexpectedly"),
 * so the cases we can recognise get prose the user can do something about —
 * the same treatment `pullFailureMessage` gives git's stderr.
 */
export function dbFailure(err: unknown): NextResponse {
  if (err instanceof DbConnectionNotFoundError) {
    return dbError(err.message, 404, "not_found");
  }
  if (err instanceof DbConnectionUnavailableError) {
    return dbError(err.message, 409, "unavailable");
  }
  if (isTimeoutError(err)) {
    return dbError(
      "The query exceeded its time limit and was cancelled. Narrow it, or raise the limit for this run.",
      504,
      "timeout",
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  return dbError(explainDriverError(message), 500);
}

/**
 * Map the driver failures that have a known cause on this machine.
 *
 * `rdsProbeErrorMessage` in the BI plugin already does this for its own probe;
 * these are the same causes seen from the client's side, plus the ones only a
 * query path hits.
 */
export function explainDriverError(message: string): string {
  const text = message.toLowerCase();

  // The most common BI failure by far, and the rawest: a several-hundred-
  // character `aws` invocation whose one useful word is "ExpiredToken". The
  // preflight says the same thing in the panel beside this, but the message
  // itself should not be a command dump.
  if (text.includes("expiredtoken") || text.includes("security token") || text.includes("token has expired")) {
    return "Your AWS credentials have expired. Sign in again from Ops, then reopen this connection.";
  }
  if (text.includes("could not be found") && text.includes("profile")) {
    return "That AWS profile is not configured on this machine. Pick one from Ops.";
  }
  if (text.includes("dbinstancenotfound")) {
    return `${message} — the database may live in another AWS account. Cross-account services need an entry in bi-rds-services.ts.`;
  }

  if (text.includes("etimedout") || text.includes("connect timeout") || text.includes("timed out")) {
    return `${message} — is Tailscale up? Private database hosts are only reachable through it.`;
  }
  if (text.includes("enotfound") || text.includes("eai_again") || text.includes("querysrv")) {
    return `${message} — the host did not resolve. Atlas PrivateLink names only resolve through the Tailscale DNS resolver.`;
  }
  if (text.includes("econnrefused")) {
    return `${message} — nothing is listening there. Check the host and port.`;
  }
  if (text.includes("password authentication failed") || text.includes("authentication failed")) {
    return `${message} — the credentials were rejected. For IAM-authenticated databases this usually means the username is not granted to your role.`;
  }
  if (text.includes("permission denied") || text.includes("not authorized")) {
    // Deliberately does not guess *why*. It may be the access mode, but it is
    // just as often a database or schema your team has no grant on at all —
    // asserting the first sends people to switch profile for no reason.
    return `${message} — your database role does not grant this. Check whether your team has access to this database, or whether it needs a different profile.`;
  }
  if (text.includes("read-only transaction") || text.includes("read only transaction")) {
    return `${message} — this connection is read-only.`;
  }
  return message;
}
