import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { listInFlightCalls, listSlowCalls } from "@/lib/exec-registry";

export const dynamic = "force-dynamic";

/**
 * What external commands is the dashboard running, and which were slow?
 *
 * The diagnostic that did not exist the day an un-timed `gh` call wedged every
 * route: the app was dead and could say nothing about why, so answering it took
 * `ps` and `lsof`. A call sitting in `inFlight` with a large `runningMs` is the
 * one holding things up.
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
  return NextResponse.json({ inFlight, slowest: listSlowCalls() });
}, "status.exec");
