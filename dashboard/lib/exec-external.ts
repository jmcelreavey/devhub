import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { beginExternalCall, endExternalCall } from "@/lib/exec-registry";
import { terminalShellEnv } from "@/lib/process-env";
import { GitMissingError, checkGit } from "@/lib/setup/git-check";

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
  /** Optional stdin. Never interpolated into a shell command. */
  input?: string | Buffer;
  /** Capture stdout as bytes so Git blobs are not decoded as text. */
  binary?: boolean;
  /** Kills the child when aborted. Rejects with an error {@link isExecAbort} recognises. */
  signal?: AbortSignal;
}

export interface ExecExternalResult {
  stdout: string;
  stderr: string;
  stdoutBuffer?: Buffer;
}

/**
 * git runs the user's hooks (pre-commit, pre-push, post-merge…), so it gets the
 * env of a user's shell, not the packaged server's managed one. That env sets
 * NPM_CONFIG_PREFIX, which makes a hook that sources nvm fail and strips the
 * Node dirs it needs. Applied here so no caller can forget it.
 */
function isGit(file: string): boolean {
  return /^git(\.exe)?$/i.test(path.basename(file));
}

export async function execExternal(
  file: string,
  args: readonly string[],
  opts: ExecExternalOptions = {},
): Promise<ExecExternalResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
  const id = beginExternalCall({ file, args, cwd: opts.cwd, label: opts.label, timeoutMs });
  const env = isGit(file) ? (terminalShellEnv(opts.env ?? process.env) as NodeJS.ProcessEnv) : opts.env;
  try {
    if (opts.binary || opts.input !== undefined || opts.signal) {
      const captured = await spawnCollected(file, [...args], {
        cwd: opts.cwd,
        env,
        maxBuffer: opts.maxBuffer ?? 32 * 1024 * 1024,
        timeoutMs,
        input: opts.input,
        binary: opts.binary === true,
        signal: opts.signal,
      });
      endExternalCall(id, { ok: true, timedOut: false });
      return captured;
    }
    const { stdout, stderr } = await execFileAsync(file, [...args], {
      encoding: "utf-8",
      cwd: opts.cwd,
      env,
      maxBuffer: opts.maxBuffer,
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      signal: opts.signal,
    });
    endExternalCall(id, { ok: true, timedOut: false });
    return { stdout, stderr };
  } catch (err) {
    endExternalCall(id, { ok: false, timedOut: isExecTimeout(err) && !isExecAbort(err) });
    // `spawn git ENOENT` tells a new user nothing; say how to install it. `code` is kept for callers that test it.
    if (file === "git" && (err as NodeJS.ErrnoException | null)?.code === "ENOENT") {
      throw Object.assign(new GitMissingError(checkGit()), { code: "ENOENT" });
    }
    throw err;
  }
}

interface SpawnCollectedOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxBuffer: number;
  timeoutMs: number;
  input?: string | Buffer;
  binary: boolean;
  signal?: AbortSignal;
}

function abortError(): Error {
  return Object.assign(new Error("The operation was aborted"), { name: "AbortError", code: "ABORT_ERR" });
}

/**
 * `execFile` always decodes stdout and has no stdin or byte-exact mode, which
 * is what reading Git blobs and feeding `cat-file --batch` need.
 */
function spawnCollected(file: string, args: string[], opts: SpawnCollectedOptions): Promise<ExecExternalResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(abortError());
      return;
    }
    const grouped = process.platform !== "win32";
    const child = spawn(file, args, { cwd: opts.cwd, env: opts.env, stdio: ["pipe", "pipe", "pipe"], detached: grouped });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutLen = 0;
    let stderrLen = 0;
    let settled = false;
    let stopped: Error | null = null;
    const stop = (err: Error) => {
      if (stopped) return;
      stopped = err;
      // Git helpers share the process group. Wait for close before callers
      // remove staging; rejecting on abort lets the child race that cleanup.
      try {
        if (grouped && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch { child.kill("SIGKILL"); }
    };
    const timer = setTimeout(() => {
      stop(Object.assign(new Error("Command timed out"), { killed: true, signal: "SIGKILL" }));
    }, opts.timeoutMs);

    const onAbort = () => {
      stop(abortError());
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      reject(err);
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutLen += chunk.length;
      if (stdoutLen > opts.maxBuffer) {
        stop(Object.assign(new Error("stdout exceeded maxBuffer"), { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }));
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrLen += chunk.length;
      if (stderrLen > opts.maxBuffer) {
        stop(Object.assign(new Error("stderr exceeded maxBuffer"), { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }));
        return;
      }
      stderrChunks.push(chunk);
    });
    // A child that exits before reading its input raises EPIPE here; the exit
    // status is what callers act on, so don't let it become an uncaught error.
    child.stdin?.on("error", () => undefined);
    child.on("error", fail);
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      if (stopped) { reject(stopped); return; }
      const stdoutBuffer = Buffer.concat(stdoutChunks);
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (code === 0 && !signal) {
        resolve({
          stdout: opts.binary ? "" : stdoutBuffer.toString("utf8"),
          stderr,
          stdoutBuffer: opts.binary ? stdoutBuffer : undefined,
        });
        return;
      }
      reject(Object.assign(new Error(stderr || `Command failed: ${file}`), {
        code: code ?? 1,
        stdout: opts.binary ? "" : stdoutBuffer.toString("utf8"),
        stderr,
        killed: signal === "SIGKILL" || signal === "SIGTERM",
        signal,
      }));
    });
    if (opts.input !== undefined) child.stdin?.end(opts.input);
    else child.stdin?.end();
  });
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

/** Was this stopped by the caller's {@link AbortSignal} rather than failing on its own? */
export function isExecAbort(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const { name, code } = err as { name?: string; code?: string };
  return name === "AbortError" || code === "ABORT_ERR";
}
