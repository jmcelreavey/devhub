/**
 * What external commands is the dashboard running right now, and which recent
 * ones were slow?
 *
 * Written after a single un-timed `gh` call held every route for 14 minutes:
 * the app was wedged and had no way to say so, so diagnosis meant `ps` and
 * `lsof` from a terminal. `/api/status/exec` surfaces this; `execExternal`
 * feeds it automatically, so anything going through the chokepoint is visible
 * without callers doing anything.
 *
 * Server-side module state, so it resets on restart (and per worker in dev).
 * That is fine — it answers "what is happening now", not "what happened last
 * Tuesday".
 */

export interface InFlightCall {
  id: number;
  /** Executable plus redacted args, for display. */
  command: string;
  cwd?: string;
  startedAt: number;
  /** Caller-supplied origin, e.g. "gh" or "git:status". */
  label?: string;
  timeoutMs: number;
}

export interface CompletedCall {
  command: string;
  cwd?: string;
  label?: string;
  durationMs: number;
  ok: boolean;
  timedOut: boolean;
  finishedAt: number;
}

/** Keep the slowest recent calls, not every call — this is a diagnostic, not a log. */
const SLOW_CALL_CAPACITY = 50;

/** Below this a call is uninteresting; it would just crowd out the real offenders. */
const SLOW_CALL_THRESHOLD_MS = 1_000;

const inFlight = new Map<number, InFlightCall>();
const slowCalls: CompletedCall[] = [];
let nextId = 1;

/**
 * Anything token-shaped never reaches the diagnostic surface. Args come from
 * our own call sites today, but this view is read by an MCP tool and rendered
 * in a page, so it must not become a way to exfiltrate a credential.
 */
const SECRET_ARG = /^(gh[pousr]_|github_pat_|xox[baprs]-|sk-|ey[A-Za-z0-9_-]{10,})/;

/**
 * Database connection URIs, which carry their credentials inline.
 *
 * The userinfo is what has to go; the host is the useful half and is what makes
 * a stuck query identifiable at all. RDS IAM auth tokens are several hundred
 * characters of signed query string, and Atlas SigV4 puts the STS session token
 * in `authMechanismProperties`, so the query string goes too.
 */
const DB_URI = /^(postgres(?:ql)?|mongodb(?:\+srv)?|mysql|mariadb|redis|rediss):\/\/(?:[^@/]*@)?([^/?#]*)/i;

export function redactArgs(args: readonly string[]): string[] {
  return args.map((arg) => {
    if (SECRET_ARG.test(arg)) return "‹redacted›";
    const uri = arg.match(DB_URI);
    if (uri) return `${uri[1]}://‹redacted›@${uri[2]}/…`;
    // `PGPASSWORD=abc`, `MYSQL_PWD=abc` — env assignments passed as argv.
    const envAssign = arg.match(/^([A-Z][A-Z0-9_]*(?:PASSWORD|PASSWD|PWD|TOKEN|SECRET))=/);
    if (envAssign) return `${envAssign[1]}=‹redacted›`;
    // `--token=abc`, `--password=abc`
    const named = arg.match(/^(--[a-z-]*(?:token|password|secret|key))=/i);
    return named ? `${named[1]}=‹redacted›` : arg;
  });
}

export function beginExternalCall(input: {
  file: string;
  args: readonly string[];
  cwd?: string;
  label?: string;
  timeoutMs: number;
}): number {
  const id = nextId++;
  inFlight.set(id, {
    id,
    command: [input.file, ...redactArgs(input.args)].join(" "),
    cwd: input.cwd,
    startedAt: Date.now(),
    label: input.label,
    timeoutMs: input.timeoutMs,
  });
  return id;
}

export function endExternalCall(id: number, outcome: { ok: boolean; timedOut: boolean }): void {
  const call = inFlight.get(id);
  if (!call) return;
  inFlight.delete(id);
  const durationMs = Date.now() - call.startedAt;
  // A timeout is always worth recording, however short the ceiling was.
  if (durationMs < SLOW_CALL_THRESHOLD_MS && !outcome.timedOut) return;
  slowCalls.unshift({
    command: call.command,
    cwd: call.cwd,
    label: call.label,
    durationMs,
    ok: outcome.ok,
    timedOut: outcome.timedOut,
    finishedAt: Date.now(),
  });
  if (slowCalls.length > SLOW_CALL_CAPACITY) slowCalls.length = SLOW_CALL_CAPACITY;
}

/** Oldest first — a wedged call is the one that has been running longest. */
export function listInFlightCalls(): InFlightCall[] {
  return [...inFlight.values()].sort((a, b) => a.startedAt - b.startedAt);
}

/** Slowest first. */
export function listSlowCalls(limit = 20): CompletedCall[] {
  return [...slowCalls].sort((a, b) => b.durationMs - a.durationMs).slice(0, limit);
}

/** Tests only. */
export function resetExecRegistry(): void {
  inFlight.clear();
  slowCalls.length = 0;
  nextId = 1;
}
