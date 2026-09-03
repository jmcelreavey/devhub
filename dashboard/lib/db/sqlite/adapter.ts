/**
 * The SQLite engine.
 *
 * Every statement runs in a child process — see `worker-source.ts` for why a
 * worker thread cannot do this job. This side owns the request/response
 * protocol, the timeout, and the one thing the child cannot do for itself:
 * being killed when it will not stop.
 *
 * Read-only is enforced by opening the file with `readOnly: true`, which is a
 * property of the handle rather than of the statement. SQLite refuses the write
 * itself, so a classifier miss cannot become a modified file.
 */

import { spawn, type ChildProcess } from "node:child_process";
import type { DbClient, DbEngineAdapter, DbRunOptions } from "../adapter";
import type { DbColumn, DbResultSet, ResolvedDbConnection } from "../types";
import { SQLITE_RUNNER_SOURCE } from "./worker-source";

interface SqliteResponse {
  id: number;
  ok: boolean;
  error?: string;
  columns?: DbColumn[];
  rows?: unknown[][];
  rowsAffected?: number;
  truncated?: boolean;
  /** Transactions report one count per statement; a single run reports one number. */
  rowsAffectedList?: number[];
}

interface SqliteConnection {
  child: ChildProcess;
  file: string;
  nextId: number;
  pending: Map<number, { resolve: (r: SqliteResponse) => void; reject: (e: Error) => void }>;
  /**
   * Set when the child dies. Every later call fails with this instead of
   * hanging on a `send()` into a dead process.
   */
  dead: Error | null;
  /** Serialises statements — one process, one database handle, one at a time. */
  queue: Promise<unknown>;
}

/** How long to wait for the child to report that it opened the file. */
const OPEN_TIMEOUT_MS = 10_000;

function fail(conn: SqliteConnection, err: Error): void {
  conn.dead = err;
  for (const { reject } of conn.pending.values()) reject(err);
  conn.pending.clear();
}

function spawnRunner(file: string): SqliteConnection {
  // `process.execPath` is the Node running the dashboard — the bundled runtime
  // in the packaged app, the system one in a checkout. Either way it is the
  // Node we already know supports `node:sqlite`.
  const child = spawn(process.execPath, ["-e", SQLITE_RUNNER_SOURCE], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    env: { ...process.env, NODE_OPTIONS: "" },
  });
  // Never hold the dashboard open because a database connection is idle.
  child.unref();

  const conn: SqliteConnection = {
    child,
    file,
    nextId: 1,
    pending: new Map(),
    dead: null,
    queue: Promise.resolve(),
  };

  child.on("message", (response: SqliteResponse) => {
    conn.pending.get(response.id)?.resolve(response);
    conn.pending.delete(response.id);
  });

  child.on("error", (err) => fail(conn, err));

  child.on("exit", (code, signal) => {
    if (!conn.dead) {
      fail(
        conn,
        new Error(
          signal
            ? `The SQLite process was stopped (${signal}).`
            : `The SQLite process exited with code ${code}.`,
        ),
      );
    } else {
      fail(conn, conn.dead);
    }
  });

  return conn;
}

/** Send one request and wait for its reply, killing the child if it overruns. */
function request(
  conn: SqliteConnection,
  message: Record<string, unknown>,
  timeoutMs: number,
  onTimeout: () => Error,
): Promise<SqliteResponse> {
  if (conn.dead) return Promise.reject(conn.dead);

  const id = conn.nextId++;
  return new Promise<SqliteResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      conn.pending.delete(id);
      const err = onTimeout();
      conn.dead = err;
      // The only thing that reliably stops synchronous SQLite. SIGTERM is not
      // enough: the process is inside a C call and will not run a handler.
      conn.child.kill("SIGKILL");
      reject(err);
    }, timeoutMs);

    conn.pending.set(id, {
      resolve: (r) => {
        clearTimeout(timer);
        resolve(r);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });

    conn.child.send({ ...message, id }, (err) => {
      if (!err) return;
      clearTimeout(timer);
      conn.pending.delete(id);
      reject(err);
    });
  });
}

async function runOne(
  conn: SqliteConnection,
  statement: string,
  opts: DbRunOptions,
): Promise<DbResultSet> {
  const started = Date.now();

  const response = await request(conn, { statement, rowLimit: opts.rowLimit }, opts.timeoutMs, () =>
    Object.assign(
      new Error(
        `The query exceeded its ${Math.round(opts.timeoutMs / 1000)}s limit. ` +
          `SQLite cannot be interrupted, so the connection was closed — it reopens on the next query.`,
      ),
      { name: "TimeoutError" },
    ),
  );

  if (!response.ok) throw new Error(response.error ?? "SQLite statement failed.");

  return {
    columns: response.columns ?? [],
    rows: response.rows ?? [],
    rowsAffected: response.rowsAffected,
    truncated: response.truncated ?? false,
    durationMs: Date.now() - started,
    statement,
  };
}

async function applyOne(
  conn: SqliteConnection,
  statements: { sql: string; params: unknown[] }[],
  opts: { timeoutMs: number },
): Promise<{ rowsAffected: number[] }> {
  const response = await request(
    conn,
    { type: "transaction", statements },
    opts.timeoutMs,
    () => Object.assign(new Error("Applying the changes timed out."), { name: "TimeoutError" }),
  );
  if (!response.ok) throw new Error(response.error ?? "The changes could not be applied.");
  return { rowsAffected: response.rowsAffectedList ?? [] };
}

export const sqliteAdapter: DbEngineAdapter = {
  engine: "sqlite",

  async open(resolved: ResolvedDbConnection): Promise<DbClient> {
    const target = resolved.sqlite;
    if (!target) throw new Error("Connection is not a SQLite target.");

    const conn = spawnRunner(target.file);

    // Open eagerly so a missing or unreadable file is reported now, by the
    // thing the user just clicked, rather than by their first query.
    const response = await request(
      conn,
      { type: "open", file: target.file, readOnly: target.readOnly },
      OPEN_TIMEOUT_MS,
      () => new Error(`Timed out opening ${target.file}.`),
    );

    if (!response.ok) {
      conn.child.kill("SIGKILL");
      throw new Error(response.error ?? `Could not open ${target.file}.`);
    }

    return conn;
  },

  async close(handle: DbClient): Promise<void> {
    const conn = handle as SqliteConnection;
    conn.dead ??= new Error("The SQLite connection was closed.");
    conn.child.kill("SIGKILL");
  },

  async ping(handle: DbClient): Promise<void> {
    const conn = handle as SqliteConnection;
    if (conn.dead) throw conn.dead;
    await runOne(conn, "SELECT 1", { timeoutMs: 5_000, rowLimit: 1, readOnly: true });
  },

  async run(handle: DbClient, statement: string, opts: DbRunOptions): Promise<DbResultSet> {
    const conn = handle as SqliteConnection;
    // One process, one database handle: statements must not overlap.
    const run = conn.queue.then(
      () => runOne(conn, statement, opts),
      () => runOne(conn, statement, opts),
    );
    conn.queue = run.catch(() => {});
    return run;
  },

  /**
   * Apply staged edits in one transaction, in the runner process.
   *
   * Queued like `run` — one process, one database handle, and a BEGIN that
   * overlapped another statement would wrap the wrong work.
   */
  async applyTransaction(
    handle: DbClient,
    statements: { sql: string; params: unknown[] }[],
    opts: { timeoutMs: number },
  ) {
    const conn = handle as SqliteConnection;

    const task = conn.queue.then(
      () => applyOne(conn, statements, opts),
      () => applyOne(conn, statements, opts),
    );
    conn.queue = task.catch(() => {});
    return task;
  },

  /**
   * Killing the process is the cancel.
   *
   * Unlike Postgres there is no signal to send the query: synchronous SQLite
   * will not check for one, and a thread-level terminate does not work either
   * (measured — see `worker-source.ts`). SIGKILL is crude but it is the only
   * thing that is actually true, and the pool reopens transparently.
   */
  async cancel(handle: DbClient): Promise<boolean> {
    const conn = handle as SqliteConnection;
    if (conn.pending.size === 0) return false;
    conn.dead = new Error("The query was cancelled.");
    conn.child.kill("SIGKILL");
    return true;
  },
};
