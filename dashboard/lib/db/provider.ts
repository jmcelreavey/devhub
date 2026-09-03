/**
 * The connection-provider seam.
 *
 * DevHub's plugin system is file-copy plus codegen; there was no runtime
 * registration point before this one (`TEMPLATE_AND_PLUGIN_PLAN.md` costed one
 * and shipped a thin core detector instead). This is that seam, kept as narrow
 * as it can be: a provider answers "what could I connect to" cheaply, and
 * "how do I connect to this one" expensively.
 *
 * The split matters. `list()` runs on every page load and must not shell out to
 * `aws`; `resolve()` runs once per connect and is allowed to take seconds
 * because it mints an IAM token. Collapsing them would make the rail as slow as
 * the slowest credential fetch.
 */

import type {
  DbAccessMode,
  DbConnectionRef,
  DbPreflight,
  ResolvedDbConnection,
} from "./types";

export interface DbPreflightOptions {
  /** Access the caller intends to use after preflight. Defaults to least-privilege read access. */
  accessMode?: DbAccessMode;
}

export interface DbConnectionProvider {
  /** Namespace for this provider's connection ids, e.g. `bi`. */
  id: string;

  /**
   * Connections this provider can offer right now. Cheap: no network, no
   * credential fetch. A connection that exists but is not currently usable
   * belongs here with `unavailable` set, not omitted — "your prd access is not
   * signed in" is more useful than a row that silently vanished.
   */
  list(): Promise<DbConnectionRef[]>;

  /**
   * Machine-level readiness (VPN up, credentials unexpired). Optional: a
   * provider whose connections are local files has nothing to check.
   */
  preflight?(id: string, options?: DbPreflightOptions): Promise<DbPreflight>;

  /**
   * Credentials for one connection. Throws with a message the user can act on
   * when it cannot — this string reaches the UI verbatim.
   */
  resolve(id: string): Promise<ResolvedDbConnection>;

  /**
   * Called when something invalidates cached state — an AWS profile switch, a
   * connection edit. Providers that cache their `list()` should drop it here.
   */
  invalidate?(): void;
}

/** Thrown by `resolve()` when the connection exists but cannot be opened yet. */
export class DbConnectionUnavailableError extends Error {
  constructor(
    readonly connectionId: string,
    message: string,
  ) {
    super(message);
    this.name = "DbConnectionUnavailableError";
  }
}

/** Thrown when an id names no known connection. Routes map this to a 404. */
export class DbConnectionNotFoundError extends Error {
  constructor(readonly connectionId: string) {
    super(`No database connection with id '${connectionId}'.`);
    this.name = "DbConnectionNotFoundError";
  }
}
