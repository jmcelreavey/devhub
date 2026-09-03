/**
 * The Postgres engine.
 *
 * Where read-only stops being advice and becomes a guarantee: reads run inside
 * `BEGIN READ ONLY`, so the server refuses a write whatever the statement
 * classifier made of it. The classifier produces the good error message; this
 * produces the actual property.
 *
 * `pg` is imported dynamically for the same reason `bi-rds.ts` does it —
 * nothing should load a database driver on a page that never opens a database.
 */

import type { Client } from "pg";
import type { DbClient, DbEngineAdapter, DbRunOptions } from "../adapter";
import { DB_CONNECT_TIMEOUT_MS } from "../timeouts";
import type { DbColumn, DbResultSet, PostgresTarget, ResolvedDbConnection } from "../types";

interface PgConnection {
  client: Client;
  /** Backend PID, needed to cancel from a second connection. */
  processId: number | null;
  target: PostgresTarget;
  /**
   * Serialises `run()` on this connection.
   *
   * Not an optimisation — a correctness fix. Each run wraps its statement in
   * BEGIN/COMMIT, and `pg` queues concurrent queries on one client in arrival
   * order. Two overlapping runs would therefore produce BEGIN, BEGIN, COMMIT,
   * COMMIT: Postgres treats the second BEGIN as a no-op with a warning, and the
   * first COMMIT commits *both* statements. On a write connection that silently
   * commits work the user had not finished describing.
   */
  queue: Promise<unknown>;
}

/** Postgres type OIDs whose text form we keep verbatim rather than letting `pg` parse. */
const OID_JSON = 114;
const OID_JSONB = 3802;

async function pg() {
  return import("pg");
}

/**
 * Render a value for the grid.
 *
 * `pg` returns Dates, Buffers and parsed JSON. The grid needs something
 * JSON-serialisable and stable, and — importantly — something that round-trips
 * back into a WHERE clause when the user edits a cell, so timestamps keep their
 * ISO form rather than a locale rendering.
 */
function toCellValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `\\x${value.toString("hex")}`;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

async function runOne(
  conn: PgConnection,
  statement: string,
  opts: DbRunOptions,
): Promise<DbResultSet> {
  const started = Date.now();

  // READ ONLY is the guarantee. Everything else — the classifier, the UI
  // affordances — exists to produce a good error before we get here.
  const begin = opts.readOnly ? "BEGIN READ ONLY" : "BEGIN";

  await conn.client.query(begin);
  try {
    // Server-side ceilings, set per transaction so they cannot leak into the
    // next statement on this pooled connection.
    await conn.client.query(`SET LOCAL statement_timeout = ${Math.floor(opts.timeoutMs)}`);
    // A transaction abandoned by a client that vanished holds its locks forever.
    await conn.client.query(
      `SET LOCAL idle_in_transaction_session_timeout = ${Math.floor(opts.timeoutMs) + 5_000}`,
    );

    const { types } = await pg();
    const result = await conn.client.query({
      text: statement,
      // `rowMode: "array"` stops duplicate column names collapsing, which a
      // join with two `id` columns otherwise does silently.
      rowMode: "array",
      types: {
        getTypeParser: ((oid: number, format: unknown) => {
          // Keep JSON as text: parsing and re-stringifying loses key order and
          // number precision, both visible in the grid and both material when
          // the value is round-tripped into an edit.
          if (oid === OID_JSON || oid === OID_JSONB) return (v: string) => v;
          return types.getTypeParser(oid, format as never);
        }) as never,
      },
    });

    await conn.client.query("COMMIT");

    const rows = (result.rows as unknown[][]) ?? [];
    const truncated = rows.length > opts.rowLimit;
    const columns: DbColumn[] = (result.fields ?? []).map((f) => ({
      name: f.name,
      dataType: pgTypeName(f.dataTypeID),
    }));

    return {
      columns,
      rows: (truncated ? rows.slice(0, opts.rowLimit) : rows).map((row) => row.map(toCellValue)),
      rowsAffected: typeof result.rowCount === "number" ? result.rowCount : undefined,
      truncated,
      durationMs: Date.now() - started,
      statement,
    };
  } catch (err) {
    // ROLLBACK on a connection whose statement was just cancelled can itself
    // fail; swallowing that keeps the original error, which is the useful one.
    await conn.client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}

/** The transaction body, run under the connection's queue. */
async function applyOne(
  conn: PgConnection,
  statements: { sql: string; params: unknown[] }[],
  opts: { timeoutMs: number },
): Promise<{ rowsAffected: number[] }> {
  await conn.client.query("BEGIN");
  try {
    await conn.client.query(`SET LOCAL statement_timeout = ${Math.floor(opts.timeoutMs)}`);
    const rowsAffected: number[] = [];

    for (const statement of statements) {
      const result = await conn.client.query(statement.sql, statement.params);
      const count = result.rowCount ?? 0;
      if (count !== 1) {
        // Rolled back by the catch below. Zero means the row changed under us;
        // more than one means the "identity" was not unique. Neither is
        // something to apply half of.
        throw new Error(
          count === 0
            ? "A row changed since it was loaded, so nothing was applied. Re-run the query and try again."
            : `A statement matched ${count} rows instead of 1, so nothing was applied. The row identity is not unique.`,
        );
      }
      rowsAffected.push(count);
    }

    await conn.client.query("COMMIT");
    return { rowsAffected };
  } catch (err) {
    await conn.client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}

export const postgresAdapter: DbEngineAdapter = {
  engine: "postgres",

  async open(resolved: ResolvedDbConnection): Promise<DbClient> {
    const target = resolved.postgres;
    if (!target) throw new Error("Connection is not a PostgreSQL target.");

    const { Client: PgClient } = await pg();
    const client = new PgClient({
      host: target.host,
      port: target.port,
      database: target.database,
      user: target.user,
      password: target.password,
      ssl: target.ssl,
      connectionTimeoutMillis: DB_CONNECT_TIMEOUT_MS,
      // The dashboard is one process serving one person, but an application
      // name makes a DevHub session identifiable in `pg_stat_activity` — which
      // matters when someone is working out who is holding a lock on prd.
      application_name: "devhub",
    });

    await client.connect();

    // Captured at connect: cancelling needs the backend PID, and asking for it
    // later means querying a connection that is by then busy.
    const processId = (client as unknown as { processID?: number }).processID ?? null;

    return { client, processId, target, queue: Promise.resolve() } satisfies PgConnection;
  },

  async close(handle: DbClient): Promise<void> {
    const conn = handle as PgConnection;
    await conn.client.end().catch(() => {});
  },

  async ping(handle: DbClient): Promise<void> {
    const conn = handle as PgConnection;
    await conn.client.query("SELECT 1");
  },

  async run(handle: DbClient, statement: string, opts: DbRunOptions): Promise<DbResultSet> {
    const conn = handle as PgConnection;
    // Chain onto whatever is already running so transactions never interleave.
    // Both handlers run the statement: a failed predecessor must not block its
    // successor, only order it.
    const run = conn.queue.then(
      () => runOne(conn, statement, opts),
      () => runOne(conn, statement, opts),
    );
    conn.queue = run.catch(() => {});
    return run;
  },

  /**
   * Apply staged edits in one transaction.
   *
   * Queued behind any running statement for the same reason `run` is: `pg`
   * serialises queries on one client, so an interleaved BEGIN would let one
   * COMMIT close someone else's transaction.
   *
   * Every statement must affect exactly one row. Zero means the row moved or
   * someone else changed it since the SELECT — the optimistic lock in the WHERE
   * clause doing its job — and more than one means the identity was not unique
   * after all. Both abort the whole apply, which is the point of the
   * transaction.
   */
  async applyTransaction(
    handle: DbClient,
    statements: { sql: string; params: unknown[] }[],
    opts: { timeoutMs: number },
  ) {
    const conn = handle as PgConnection;
    const task = conn.queue.then(
      () => applyOne(conn, statements, opts),
      () => applyOne(conn, statements, opts),
    );
    conn.queue = task.catch(() => {});
    return task;
  },

  /**
   * Cancel from a *second* connection.
   *
   * `pg` cannot interrupt a query on a busy connection — the protocol requires
   * the cancel request to arrive out of band. So we open a throwaway connection
   * and ask the server to signal the backend. This is what makes the Cancel
   * button real rather than cosmetic.
   */
  async cancel(handle: DbClient): Promise<boolean> {
    const conn = handle as PgConnection;
    if (!conn.processId) return false;

    const { Client: PgClient } = await pg();
    const canceller = new PgClient({
      host: conn.target.host,
      port: conn.target.port,
      database: conn.target.database,
      user: conn.target.user,
      password: conn.target.password,
      ssl: conn.target.ssl,
      connectionTimeoutMillis: DB_CONNECT_TIMEOUT_MS,
      application_name: "devhub-cancel",
    });

    try {
      await canceller.connect();
      const result = await canceller.query("SELECT pg_cancel_backend($1) AS cancelled", [
        conn.processId,
      ]);
      return (result.rows[0] as { cancelled?: boolean } | undefined)?.cancelled === true;
    } catch {
      return false;
    } finally {
      await canceller.end().catch(() => {});
    }
  },
};

/**
 * Column type names for the grid header.
 *
 * Only the types worth naming — the header exists to help the user read the
 * data, and "oid 1184" helps nobody. Anything unmapped falls back to the OID,
 * which is at least greppable.
 */
const PG_TYPE_NAMES: Record<number, string> = {
  16: "bool",
  17: "bytea",
  20: "int8",
  21: "int2",
  23: "int4",
  25: "text",
  114: "json",
  700: "float4",
  701: "float8",
  1042: "bpchar",
  1043: "varchar",
  1082: "date",
  1083: "time",
  1114: "timestamp",
  1184: "timestamptz",
  1700: "numeric",
  2950: "uuid",
  3802: "jsonb",

  // Array types get their own OIDs. Naming the common ones matters more than it
  // looks: `oid:1009` in a column header tells the reader nothing, and `text[]`
  // tells them why the cell contains JSON.
  1000: "bool[]",
  1005: "int2[]",
  1007: "int4[]",
  1009: "text[]",
  1015: "varchar[]",
  1016: "int8[]",
  1021: "float4[]",
  1022: "float8[]",
  1115: "timestamp[]",
  1182: "date[]",
  1185: "timestamptz[]",
  1231: "numeric[]",
  2951: "uuid[]",
  199: "json[]",
  3807: "jsonb[]",
};

export function pgTypeName(oid: number): string {
  return PG_TYPE_NAMES[oid] ?? `oid:${oid}`;
}
