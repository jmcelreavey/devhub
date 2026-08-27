import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { beginExternalCall, endExternalCall } from "@/lib/exec-registry";

const execFileAsync = promisify(execFile);

/**
 * Every external command the dashboard runs goes through here.
 *
 * The rule this exists to enforce: **an external command always has a
 * ceiling.** Node's default is to wait forever, and "forever" is not a
 * degraded mode — one un-timed `gh` call blocked the event loop and took every
 * route down with it for 14 minutes. `git` behaves the same way against a held
 * `index.lock` or a hook waiting on stdin.
 *
 * The timeout is opt-*out* by value, not by omission: leaving `timeoutMs` off
 * gets you the default, never "unbounded". Pass a bigger number for genuinely
 * slow work; there is deliberately no way to ask for no limit.
 *
 * SIGKILL rather than SIGTERM because the processes worth killing here are the
 * ones ignoring polite requests.
 */
export const DEFAULT_EXEC_TIMEOUT_MS = Number(process.env.DEVHUB_EXEC_TIMEOUT_MS ?? 30_000);

export interface ExecExternalOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxBuffer?: number;
  /** Ceiling in ms. Omit for {@link DEFAULT_EXEC_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Origin shown in diagnostics, e.g. "gh" or "git:fetch". */
  label?: string;
}

export interface ExecExternalResult {
  stdout: string;
  stderr: string;
}

export async function execExternal(
  file: string,
  args: readonly string[],
  opts: ExecExternalOptions = {},
): Promise<ExecExternalResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
  const id = beginExternalCall({ file, args, cwd: opts.cwd, label: opts.label, timeoutMs });
  try {
    const { stdout, stderr } = await execFileAsync(file, [...args], {
      encoding: "utf-8",
      cwd: opts.cwd,
      env: opts.env,
      maxBuffer: opts.maxBuffer,
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    });
    endExternalCall(id, { ok: true, timedOut: false });
    return { stdout, stderr };
  } catch (err) {
    endExternalCall(id, { ok: false, timedOut: isExecTimeout(err) });
    throw err;
  }
}

/**
 * Did we kill this because it exceeded its ceiling?
 *
 * A killed process reports `killed`/`signal` and carries no message worth
 * grepping, so anything that decides "is this a timeout?" has to check the
 * structure. Matching on error text instead is how a stale-cache fallback
 * ended up unreachable in practice.
 */
export function isExecTimeout(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const { killed, signal } = err as { killed?: boolean; signal?: string | null };
  return killed === true && (signal === "SIGKILL" || signal === "SIGTERM");
}
