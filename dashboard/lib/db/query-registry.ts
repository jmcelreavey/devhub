/**
 * What database queries is the dashboard running right now, and which recent
 * ones were slow?
 *
 * The sibling of `lib/exec-registry.ts`, and it exists for the same reason. The
 * debug-hang ladder starts at `/api/status/exec` because one blocked call takes
 * every route down; a query that never returns has to be findable at that same
 * first rung, or the ladder quietly stops working the day the DB client ships.
 *
 * Driver calls are async and do not block the event loop the way a wedged
 * subprocess does — with the loud exception of SQLite, which is synchronous and
 * therefore runs in a worker. Either way, a query holding a pool slot or a prd
 * row lock is worth naming.
 *
 * Module state, so it resets on restart. It answers "what is happening now".
 */

import type { DbEngine } from "./types";

export interface InFlightQuery {
  id: number;
  connectionId: string;
  engine: DbEngine;
  /** Redacted, single-line, truncated. Enough to recognise, never enough to leak. */
  summary: string;
  startedAt: number;
  timeoutMs: number;
  /** Set once the engine reports a handle we could cancel with. */
  cancellable: boolean;
}

export interface CompletedQuery {
  connectionId: string;
  engine: DbEngine;
  summary: string;
  durationMs: number;
  ok: boolean;
  timedOut: boolean;
  finishedAt: number;
}

const SLOW_QUERY_CAPACITY = 50;

/**
 * Higher than the exec registry's 1s. A 1.2s query is ordinary; a 1.2s
 * subprocess is not, and mixing the two thresholds would bury the real
 * offenders under routine traffic.
 */
const SLOW_QUERY_THRESHOLD_MS = 3_000;

/**
 * State lives on `globalThis`, not in module scope.
 *
 * `exec-registry.ts` uses plain module state and gets away with it. This cannot:
 * the writer is `/api/db/[id]/query` and the reader is `/api/status/exec`, and
 * Next bundles route handlers into separate module graphs — so a module-level
 * Map is a *different* Map on each side.
 *
 * Measured, not assumed. With the pool pinned to `globalThis` and this left in
 * module scope, one `/api/status/exec` call during a running query returned the
 * pooled connection with `busy: 1` and an empty `dbQueries` in the same
 * response. Same request, same instant: the globalThis-backed half crossed the
 * boundary and the module-backed half did not.
 *
 * A diagnostic that silently reports "nothing running" while something is
 * running is worse than no diagnostic, because the debug-hang ladder starts
 * here and would send you looking somewhere else.
 */
interface QueryRegistryState {
  inFlight: Map<number, InFlightQuery>;
  slowQueries: CompletedQuery[];
  nextId: number;
}

const GLOBAL_KEY = Symbol.for("devhub.db.queryRegistry");

function state(): QueryRegistryState {
  const g = globalThis as unknown as Record<symbol, QueryRegistryState | undefined>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = { inFlight: new Map(), slowQueries: [], nextId: 1 };
  }
  return g[GLOBAL_KEY];
}

/**
 * A one-line, length-capped, credential-free rendering of a statement.
 *
 * This string is rendered on the status page and returned by an MCP tool, so it
 * gets the same treatment as `redactArgs`: anything password-shaped goes.
 * Queries legitimately contain literals (a WHERE on an email address), so the
 * cap does most of the work and the patterns catch the obvious mistakes —
 * someone pasting a connection string or a `PASSWORD '…'` into the editor.
 */
export function summarizeStatement(statement: string, maxLength = 120): string {
  const oneLine = statement.replace(/\s+/g, " ").trim();
  const scrubbed = oneLine
    .replace(/\b(postgres(?:ql)?|mongodb(?:\+srv)?|mysql|redis)s?:\/\/\S+/gi, "$1://‹redacted›")
    .replace(/\b(password|secret|token)\b(\s+|\s*=\s*)'[^']*'/gi, "$1$2'‹redacted›'");
  return scrubbed.length > maxLength ? `${scrubbed.slice(0, maxLength - 1)}…` : scrubbed;
}

export function beginQuery(input: {
  connectionId: string;
  engine: DbEngine;
  statement: string;
  timeoutMs: number;
}): number {
  const s = state();
  const id = s.nextId++;
  s.inFlight.set(id, {
    id,
    connectionId: input.connectionId,
    engine: input.engine,
    summary: summarizeStatement(input.statement),
    startedAt: Date.now(),
    timeoutMs: input.timeoutMs,
    cancellable: false,
  });
  return id;
}

/** Mark a query as cancellable once the engine hands back something to cancel with. */
export function markQueryCancellable(id: number): void {
  const q = state().inFlight.get(id);
  if (q) q.cancellable = true;
}

export function endQuery(id: number, outcome: { ok: boolean; timedOut: boolean }): void {
  const s = state();
  const q = s.inFlight.get(id);
  if (!q) return;
  s.inFlight.delete(id);
  const durationMs = Date.now() - q.startedAt;
  // A timeout is always worth recording, however short the ceiling was.
  if (durationMs < SLOW_QUERY_THRESHOLD_MS && !outcome.timedOut) return;
  s.slowQueries.unshift({
    connectionId: q.connectionId,
    engine: q.engine,
    summary: q.summary,
    durationMs,
    ok: outcome.ok,
    timedOut: outcome.timedOut,
    finishedAt: Date.now(),
  });
  if (s.slowQueries.length > SLOW_QUERY_CAPACITY) s.slowQueries.length = SLOW_QUERY_CAPACITY;
}

/** Oldest first — a wedged query is the one that has been running longest. */
export function listInFlightQueries(): InFlightQuery[] {
  return [...state().inFlight.values()].sort((a, b) => a.startedAt - b.startedAt);
}

/** Slowest first. */
export function listSlowQueries(limit = 20): CompletedQuery[] {
  return [...state().slowQueries].sort((a, b) => b.durationMs - a.durationMs).slice(0, limit);
}

/** Tests only. */
export function resetQueryRegistry(): void {
  const s = state();
  s.inFlight.clear();
  s.slowQueries.length = 0;
  s.nextId = 1;
}
