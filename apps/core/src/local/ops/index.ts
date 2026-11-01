import { execFile, spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { syncLocalOps } from "./sync.mjs";
import { requestContext } from "./context";

export type ProcessHandle = ChildProcess;

export interface LocalRunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxBuffer?: number;
  timeoutMs?: number;
  input?: string | Buffer;
  binary?: boolean;
  onStdout?: (chunk: Buffer) => void;
  signal?: AbortSignal;
  managedService?: boolean;
  /** Use the process-group-aware collector, including for plain Git commands. */
  collect?: boolean;
}

export interface LocalCommandError extends Error {
  code?: string | number;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
  killed?: boolean;
  signal?: NodeJS.Signals | null;
}

export interface LocalRunResult {
  stdout: string;
  stderr: string;
  stdoutBuffer?: Buffer;
}

export interface LocalGitOptions extends LocalRunOptions {
  executable?: string;
}

export interface LocalOps {
  git(op: string | undefined, args: readonly string[], opts?: LocalGitOptions): Promise<LocalRunResult>;
  run(cli: string, args: readonly string[], opts?: LocalRunOptions): Promise<LocalRunResult>;
  /** Long-running and interactive programs need a live process handle. */
  spawn: typeof spawn;
  runSync: typeof syncLocalOps.runSync;
  spawnSync: typeof syncLocalOps.spawnSync;
}

async function run(cli: string, args: readonly string[], opts: LocalRunOptions = {}): Promise<LocalRunResult> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  if (opts.collect || opts.binary || opts.input !== undefined || opts.signal || opts.onStdout || opts.managedService) {
    return spawnCollected(cli, [...args], {
      cwd: opts.cwd,
      env: opts.env,
      maxBuffer: opts.maxBuffer ?? 32 * 1024 * 1024,
      timeoutMs,
      input: opts.input,
      binary: opts.binary === true,
      onStdout: opts.onStdout,
      signal: opts.signal,
      managedService: opts.managedService,
    });
  }
  const { stdout, stderr } = await promisify(execFile)(cli, [...args], {
    encoding: "utf-8",
    cwd: opts.cwd,
    env: opts.env,
    maxBuffer: opts.maxBuffer,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  });
  return { stdout, stderr };
}

export const inProcessLocalOps: LocalOps = {
  ...syncLocalOps,
  run,
  git: (op, args, opts = {}) => run(opts.executable ?? "git", op === undefined ? args : [op, ...args], { ...opts, collect: true }),
  spawn: ((...args: Parameters<typeof spawn>) => spawn(...args)) as typeof spawn,
};

function requireInProcess(): LocalOps {
  if (requestContext()?.localOps) throw new Error("Interactive and synchronous operations are unavailable on the remote local agent");
  return inProcessLocalOps;
}

export const localOps: LocalOps = {
  run: (...args) => (requestContext()?.localOps ?? inProcessLocalOps).run(...args),
  git: (...args) => (requestContext()?.localOps ?? inProcessLocalOps).git(...args),
  spawn: ((...args: Parameters<typeof spawn>) => requireInProcess().spawn(...args)) as typeof spawn,
  runSync: ((...args: Parameters<typeof syncLocalOps.runSync>) => requireInProcess().runSync(...args)) as typeof syncLocalOps.runSync,
  spawnSync: ((...args: Parameters<typeof syncLocalOps.spawnSync>) => requireInProcess().spawnSync(...args)) as typeof syncLocalOps.spawnSync,
};

interface SpawnCollectedOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxBuffer: number;
  timeoutMs: number;
  input?: string | Buffer;
  binary: boolean;
  onStdout?: (chunk: Buffer) => void;
  signal?: AbortSignal;
  managedService?: boolean;
}

function abortError(): Error {
  return Object.assign(new Error("The operation was aborted"), { name: "AbortError", code: "ABORT_ERR" });
}

/**
 * `execFile` always decodes stdout and has no stdin or byte-exact mode, which
 * is what reading Git blobs and feeding `cat-file --batch` need.
 */
function spawnCollected(file: string, args: string[], opts: SpawnCollectedOptions): Promise<LocalRunResult> {
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
        else if (child.pid && (process.env.SystemRoot || process.env.WINDIR)) {
          const executable = path.join((process.env.SystemRoot || process.env.WINDIR)!, "System32", "taskkill.exe");
          const killer = spawn(executable, ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
          const fallback = () => { if (child.exitCode === null) child.kill("SIGKILL"); };
          const killTimer = setTimeout(() => { killer.kill(); fallback(); }, 2000);
          killTimer.unref();
          killer.once("error", () => { clearTimeout(killTimer); fallback(); });
          killer.once("exit", () => { clearTimeout(killTimer); fallback(); });
        } else child.kill("SIGKILL");
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
      try { opts.onStdout?.(chunk); }
      catch (error) { stop(error instanceof Error ? error : new Error(String(error))); }
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
    child.stdin?.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") stop(error);
    });
    child.on("error", fail);
    // A service must not leave helpers running after its main process exits.
    child.on("exit", () => {
      if (opts.managedService && grouped && child.pid) {
        try { process.kill(-child.pid, "SIGKILL"); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
            stop(error instanceof Error ? error : new Error(String(error)));
          }
        }
      }
    });
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
