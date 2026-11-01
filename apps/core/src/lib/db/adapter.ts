/**
 * What an engine has to provide.
 *
 * Deliberately small. The pool owns connection lifecycle — opening, expiry,
 * idle eviction — and each engine owns the things that genuinely differ:
 * how you open a socket, how you cancel a running statement, and how you turn
 * a result into rows.
 *
 * Adapters are loaded lazily by `pool.ts` so that installing DevHub without
 * ever opening a Mongo connection never loads the Mongo driver.
 */

import type { DbEngine, DbResultSet, ResolvedDbConnection } from "./types";

/**
 * A live connection. Opaque to the pool — only the adapter that made it knows
 * what is inside.
 */
export type DbClient = unknown;

export interface DbRunOptions {
  timeoutMs: number;
  /** Row ceiling for this run. The adapter must stop fetching, not just slice. */
  rowLimit: number;
  /**
   * Open the statement in a read-only transaction. This is the actual
   * guarantee behind read-only connections; the statement classifier is only
   * the fast, legible half of it.
   */
  readOnly: boolean;
  signal?: AbortSignal;
}

export interface DbEngineAdapter {
  engine: DbEngine;

  /** Open one connection. Must honour {@link DB_CONNECT_TIMEOUT_MS}. */
  open(resolved: ResolvedDbConnection): Promise<DbClient>;

  /** Close it. Must not throw — the pool calls this while evicting. */
  close(client: DbClient): Promise<void>;

  /**
   * Cheap liveness check before a cached client is handed back. A pooled
   * connection can have been killed server-side (an RDS failover, an idle
   * reaper) without us noticing, and the failure surfaces as a confusing error
   * on the user's next query rather than as a reconnect.
   */
  ping(client: DbClient): Promise<void>;

  /** Run one statement and materialize a result set. */
  run(client: DbClient, statement: string, opts: DbRunOptions): Promise<DbResultSet>;

  /**
   * Ask the server to cancel whatever this client is running. Best-effort:
   * returns false when the engine offers no way to do it.
   */
  cancel(client: DbClient): Promise<boolean>;

  /**
   * Apply several parameterised statements as one unit.
   *
   * Separate from {@link run} because grid edits need two things `run` cannot
   * give: bound parameters (a cell value must never become SQL text) and
   * all-or-nothing semantics (half-applied edits are worse than none).
   *
   * Optional. An engine without transactions simply does not offer it, and the
   * route says so rather than applying statements one by one and hoping.
   */
  applyTransaction?(
    client: DbClient,
    statements: DbParameterisedStatement[],
    opts: { timeoutMs: number },
  ): Promise<DbApplyResult>;
}

export interface DbParameterisedStatement {
  sql: string;
  params: unknown[];
}

export interface DbApplyResult {
  /** Rows affected per statement, in order. */
  rowsAffected: number[];
}
