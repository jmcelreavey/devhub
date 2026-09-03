/**
 * Live database connections, one per connection id.
 *
 * Three jobs, all of which are the kind of thing that looks optional until it
 * bites:
 *
 * - **Reuse.** Opening an RDS connection costs an `aws` shell-out for the IAM
 *   token plus a TLS handshake. Doing that per keystroke in a table filter is
 *   not viable.
 * - **Expiry.** RDS IAM tokens last 15 minutes and Atlas rides STS session
 *   credentials. Both engines authenticate at connect time only, so an open
 *   socket outlives its password — we re-resolve before opening a *new* one
 *   rather than tearing down a working session on a timer.
 * - **Eviction.** An idle connection holds a server-side slot. Five minutes.
 *
 * State is pinned to `globalThis`. Everything else in this codebase uses plain
 * module state, and this deviates for one reason: Next's dev server re-evaluates
 * modules on edit, and a module-local Map would strand the old sockets with
 * nothing left holding a reference to close them. Leaking metadata is untidy;
 * leaking Postgres backends against prd is a page from someone else.
 */

import type { DbClient, DbEngineAdapter, DbRunOptions } from "./adapter";
import { resolveDbConnection } from "./registry";
import { beginQuery, endQuery, markQueryCancellable } from "./query-registry";
import {
  DB_CREDENTIAL_SKEW_MS,
  DB_IDLE_EVICT_MS,
  DB_QUERY_TIMEOUT_MS,
} from "./timeouts";
import { DB_DEFAULT_ROW_LIMIT, type DbEngine, type DbResultSet, type ResolvedDbConnection } from "./types";

interface PooledConnection {
  connectionId: string;
  engine: DbEngine;
  resolved: ResolvedDbConnection;
  client: DbClient;
  adapter: DbEngineAdapter;
  openedAt: number;
  lastUsedAt: number;
  /** Statements currently running on this client. Never evict a busy connection. */
  busy: number;
}

interface PoolState {
  connections: Map<string, PooledConnection>;
  /** In-flight `open()` calls, so two concurrent requests don't open two sockets. */
  opening: Map<string, Promise<PooledConnection>>;
  sweeper: NodeJS.Timeout | null;
}

const GLOBAL_KEY = Symbol.for("devhub.db.pool");

function state(): PoolState {
  const g = globalThis as unknown as Record<symbol, PoolState | undefined>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = { connections: new Map(), opening: new Map(), sweeper: null };
  }
  return g[GLOBAL_KEY];
}

/**
 * Engines are loaded on first use. Installing DevHub and never opening a Mongo
 * connection should never load the Mongo driver — the same reason `bi-rds.ts`
 * writes `await import("pg")` rather than a top-level import.
 *
 * Each engine's phase adds its entry here.
 */
const ADAPTER_LOADERS: Partial<Record<DbEngine, () => Promise<DbEngineAdapter>>> = {
  postgres: async () => (await import("./postgres/adapter")).postgresAdapter,
  mongodb: async () => (await import("./mongo/adapter")).mongoAdapter,
  sqlite: async () => (await import("./sqlite/adapter")).sqliteAdapter,
};

const ENGINE_LABEL: Record<DbEngine, string> = {
  postgres: "PostgreSQL",
  mongodb: "MongoDB",
  sqlite: "SQLite",
};

async function adapterFor(engine: DbEngine): Promise<DbEngineAdapter> {
  const loader = ADAPTER_LOADERS[engine];
  if (!loader) throw new Error(`${ENGINE_LABEL[engine]} support is not available in this build.`);
  return loader();
}

/** Credentials that will not authenticate a new connection by the time we use them. */
function credentialsSpent(resolved: ResolvedDbConnection): boolean {
  if (!resolved.expiresAt) return false;
  return Date.now() + DB_CREDENTIAL_SKEW_MS >= resolved.expiresAt;
}

function startSweeper(): void {
  const s = state();
  if (s.sweeper) return;
  s.sweeper = setInterval(() => {
    void sweepIdleConnections();
  }, 60_000);
  // Never hold the process open for a housekeeping timer.
  s.sweeper.unref?.();
}

export async function sweepIdleConnections(now = Date.now()): Promise<void> {
  const s = state();
  for (const [id, conn] of [...s.connections]) {
    if (conn.busy > 0) continue;
    if (now - conn.lastUsedAt < DB_IDLE_EVICT_MS) continue;
    s.connections.delete(id);
    await conn.adapter.close(conn.client).catch(() => {});
  }
}

async function openConnection(connectionId: string): Promise<PooledConnection> {
  const resolved = await resolveDbConnection(connectionId);
  const adapter = await adapterFor(resolved.engine);
  const client = await adapter.open(resolved);
  const now = Date.now();
  return {
    connectionId,
    engine: resolved.engine,
    resolved,
    client,
    adapter,
    openedAt: now,
    lastUsedAt: now,
    busy: 0,
  };
}

/**
 * Get a live connection, opening one if needed.
 *
 * Concurrent callers share a single `open()` — the table grid and the schema
 * tree both fetch on mount, and two IAM token mints for one click is a waste
 * that shows up as a visibly slower first paint.
 */
export async function acquire(connectionId: string): Promise<PooledConnection> {
  const s = state();
  startSweeper();

  const existing = s.connections.get(connectionId);
  if (existing) {
    // A pooled connection can be dead server-side — an RDS failover, an idle
    // reaper — and finding out via the user's next query is a bad way to learn.
    try {
      await existing.adapter.ping(existing.client);
      existing.lastUsedAt = Date.now();
      return existing;
    } catch {
      s.connections.delete(connectionId);
      await existing.adapter.close(existing.client).catch(() => {});
    }
  }

  const pending = s.opening.get(connectionId);
  if (pending) return pending;

  const promise = openConnection(connectionId)
    .then((conn) => {
      s.connections.set(connectionId, conn);
      return conn;
    })
    .finally(() => {
      s.opening.delete(connectionId);
    });

  s.opening.set(connectionId, promise);
  return promise;
}

export interface RunStatementOptions {
  timeoutMs?: number;
  rowLimit?: number;
  /** Force the read-only transaction mode regardless of what the connection allows. */
  readOnly: boolean;
  signal?: AbortSignal;
}

/**
 * Run one statement on a pooled connection, tracked and bounded.
 *
 * Every query goes through here, which is what makes `/api/status/exec` able to
 * name a stuck one. Anything that opens its own connection and runs a statement
 * directly is invisible to that, so don't.
 */
export async function runStatement(
  connectionId: string,
  statement: string,
  opts: RunStatementOptions,
): Promise<DbResultSet> {
  let conn = await acquire(connectionId);

  // The socket is fine but its password has aged out; a *new* one would fail.
  // Reopen now, while we can still explain it, rather than at the next reconnect.
  if (credentialsSpent(conn.resolved)) {
    await closeConnection(connectionId);
    conn = await acquire(connectionId);
  }

  const timeoutMs = opts.timeoutMs ?? DB_QUERY_TIMEOUT_MS;
  const runOpts: DbRunOptions = {
    timeoutMs,
    rowLimit: opts.rowLimit ?? DB_DEFAULT_ROW_LIMIT,
    readOnly: opts.readOnly,
    signal: opts.signal,
  };

  const queryId = beginQuery({ connectionId, engine: conn.engine, statement, timeoutMs });
  markQueryCancellable(queryId);
  conn.busy++;
  let timedOut = false;

  try {
    const result = await conn.adapter.run(conn.client, statement, runOpts);
    endQuery(queryId, { ok: true, timedOut: false });
    return result;
  } catch (err) {
    timedOut = isTimeoutError(err);
    endQuery(queryId, { ok: false, timedOut });
    throw err;
  } finally {
    conn.busy--;
    conn.lastUsedAt = Date.now();
  }
}

/**
 * Apply staged edits as one transaction.
 *
 * Tracked like a query, so a slow apply is as visible in `/api/status/exec` as
 * a slow SELECT — and bounded, so it cannot hold a write lock indefinitely.
 */
export async function applyTransaction(
  connectionId: string,
  statements: { sql: string; params: unknown[] }[],
  opts: { timeoutMs?: number } = {},
): Promise<{ rowsAffected: number[] }> {
  let conn = await acquire(connectionId);
  if (credentialsSpent(conn.resolved)) {
    await closeConnection(connectionId);
    conn = await acquire(connectionId);
  }

  if (!conn.adapter.applyTransaction) {
    throw new Error(
      `${ENGINE_LABEL[conn.engine]} connections do not support transactional edits in DevHub.`,
    );
  }

  const timeoutMs = opts.timeoutMs ?? DB_QUERY_TIMEOUT_MS;
  const queryId = beginQuery({
    connectionId,
    engine: conn.engine,
    statement: `apply ${statements.length} staged change(s)`,
    timeoutMs,
  });
  conn.busy++;

  try {
    const result = await conn.adapter.applyTransaction(conn.client, statements, { timeoutMs });
    endQuery(queryId, { ok: true, timedOut: false });
    return result;
  } catch (err) {
    endQuery(queryId, { ok: false, timedOut: isTimeoutError(err) });
    throw err;
  } finally {
    conn.busy--;
    conn.lastUsedAt = Date.now();
  }
}

/** Ask the server to cancel whatever this connection is running. */
export async function cancelConnection(connectionId: string): Promise<boolean> {
  const conn = state().connections.get(connectionId);
  if (!conn) return false;
  return conn.adapter.cancel(conn.client).catch(() => false);
}

export async function closeConnection(connectionId: string): Promise<void> {
  const s = state();
  const conn = s.connections.get(connectionId);
  if (!conn) return;
  s.connections.delete(connectionId);
  await conn.adapter.close(conn.client).catch(() => {});
}

/** Drop every connection — used when an AWS profile switch invalidates credentials. */
export async function closeAllConnections(): Promise<void> {
  const s = state();
  const all = [...s.connections.values()];
  s.connections.clear();
  await Promise.all(all.map((c) => c.adapter.close(c.client).catch(() => {})));
}

export interface OpenConnectionInfo {
  connectionId: string;
  engine: DbEngine;
  openedAt: number;
  lastUsedAt: number;
  busy: number;
  /** When the credentials behind this connection stop working for new sockets. */
  expiresAt?: number;
}

export function listOpenConnections(): OpenConnectionInfo[] {
  return [...state().connections.values()].map((c) => ({
    connectionId: c.connectionId,
    engine: c.engine,
    openedAt: c.openedAt,
    lastUsedAt: c.lastUsedAt,
    busy: c.busy,
    expiresAt: c.resolved.expiresAt,
  }));
}

/**
 * Did we abandon this because it exceeded its ceiling?
 *
 * Matched on structure and on the engines' own codes rather than on message
 * text — `exec-external.ts` records what happens when a fallback path keys off
 * a string that later changed.
 */
export function isTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; code?: string | number };
  if (e.name === "AbortError" || e.name === "TimeoutError") return true;
  // Postgres 57014 query_canceled; MongoDB 50 MaxTimeMSExpired.
  return e.code === "57014" || e.code === 50;
}

/** Tests only. */
export function registerAdapterForTests(engine: DbEngine, adapter: DbEngineAdapter): void {
  ADAPTER_LOADERS[engine] = async () => adapter;
}

/** Tests only. */
export async function resetPool(): Promise<void> {
  const s = state();
  await closeAllConnections();
  s.opening.clear();
  if (s.sweeper) {
    clearInterval(s.sweeper);
    s.sweeper = null;
  }
}
