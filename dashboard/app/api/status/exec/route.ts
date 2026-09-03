import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { listInFlightCalls, listSlowCalls } from "@/lib/exec-registry";
import { listInFlightQueries, listSlowQueries } from "@/lib/db/query-registry";
import { listOpenConnections } from "@/lib/db/pool";

export const dynamic = "force-dynamic";

/**
 * What external commands is the dashboard running, and which were slow?
 *
 * The diagnostic that did not exist the day an un-timed `gh` call wedged every
 * route: the app was dead and could say nothing about why, so answering it took
 * `ps` and `lsof`. A call sitting in `inFlight` with a large `runningMs` is the
 * one holding things up.
 *
 * Database queries report here too. They are async and do not block the event
 * loop the way a wedged subprocess does — SQLite excepted, which is why it runs
 * in a worker — but "the page is stuck" looks identical from the outside
 * whether the cause is a subprocess or a query holding a prd lock. Splitting
 * them across two diagnostics would mean the debug-hang ladder's first rung
 * silently stopped covering half the causes.
 */
export const GET = withErrorHandler(async () => {
  const now = Date.now();
  const inFlight = listInFlightCalls().map((call) => ({
    command: call.command,
    cwd: call.cwd,
    label: call.label,
    runningMs: now - call.startedAt,
    timeoutMs: call.timeoutMs,
    /** Past its ceiling but not yet reaped — the shape of a genuine wedge. */
    overdue: now - call.startedAt > call.timeoutMs,
  }));

  const dbQueries = listInFlightQueries().map((query) => ({
    connectionId: query.connectionId,
    engine: query.engine,
    statement: query.summary,
    runningMs: now - query.startedAt,
    timeoutMs: query.timeoutMs,
    overdue: now - query.startedAt > query.timeoutMs,
    cancellable: query.cancellable,
  }));

  return NextResponse.json({
    inFlight,
    slowest: listSlowCalls(),
    dbQueries,
    dbSlowest: listSlowQueries(),
    dbConnections: listOpenConnections(),
  });
}, "status.exec");
