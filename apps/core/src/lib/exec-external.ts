import { localOps } from "../local/ops/index";
import path from "node:path";
import { beginExternalCall, endExternalCall } from "./exec-registry";
import { terminalShellEnv } from "../local/process-env";
import { assessGitAvailability } from "./setup/git-availability";
import { GitMissingError, missingGitCheck } from "./setup/git-error";
import { gitMutationEnv, withRepoGitMutation } from "./git/mutation-queue";
import { gitMutationRoot } from "./git/command";

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
  gitEnvOverrides?: Record<string, string>;
  maxBuffer?: number;
  /** Ceiling in ms. Omit for {@link DEFAULT_EXEC_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Origin shown in diagnostics, e.g. "gh" or "git:fetch". */
  label?: string;
  /** Optional stdin. Never interpolated into a shell command. */
  input?: string | Buffer;
  /** Capture stdout as bytes so Git blobs are not decoded as text. */
  binary?: boolean;
  /** Observe bounded stdout while retaining the final result. */
  onStdout?: (chunk: Buffer) => void;
  /** Observe bounded stderr while retaining the final result. */
  onStderr?: (chunk: Buffer) => void;
  /** Kills the child when aborted. Rejects with an error {@link isExecAbort} recognises. */
  signal?: AbortSignal;
  /** Owned service with its own health UI; remains timed and cancellable. */
  managedService?: boolean;
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
  return /^git(?:\.exe|\.cmd)?$/i.test(path.basename(file));
}

export async function execExternal(
  file: string,
  args: readonly string[],
  opts: ExecExternalOptions = {},
): Promise<ExecExternalResult> {
  const gitCommand = isGit(file);
  const root = gitCommand ? gitMutationRoot(args, opts.cwd, { ...(opts.env ?? process.env), ...opts.gitEnvOverrides }) : null;
  if (root) return withRepoGitMutation(root, () => execute(file, args, opts, false), opts.signal);
  return execute(file, args, opts, gitCommand);
}

async function execute(file: string, args: readonly string[], opts: ExecExternalOptions, readOnlyGit: boolean): Promise<ExecExternalResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
  const id = beginExternalCall({ file, args, cwd: opts.cwd, label: opts.label, timeoutMs, managedService: opts.managedService });
  const gitCommand = isGit(file);
  // Git status can refresh the index; reads outside the queue must not write it.
  const env = gitMutationEnv(gitCommand
    ? { ...terminalShellEnv(opts.env ?? process.env), ...opts.gitEnvOverrides, ...(readOnlyGit ? { GIT_OPTIONAL_LOCKS: "0" } : {}) } as NodeJS.ProcessEnv
    : opts.env ?? process.env);
  let executable = file;
  if (gitCommand) {
    // A caller-supplied env is searched as-is so an empty PATH stays empty.
    // The dashboard's own probes omit env and augment PATH, so Homebrew git
    // wins over Apple's /usr/bin shim.
    const gate = await assessGitAvailability({
      env: env ?? process.env,
      augment: opts.env == null,
    });
    if (!gate.runnable || !gate.bin) {
      endExternalCall(id, { ok: false, timedOut: false });
      throw Object.assign(new GitMissingError(missingGitCheck()), { code: "ENOENT" });
    }
    executable = gate.bin;
  }
  try {
    const runOpts = {
      cwd: opts.cwd,
      env,
      maxBuffer: opts.maxBuffer,
      timeoutMs,
      input: opts.input,
      binary: opts.binary,
      onStdout: opts.onStdout,
      onStderr: opts.onStderr,
      signal: opts.signal,
      managedService: opts.managedService,
    };
    const result = gitCommand
      ? await localOps.git(args[0], args.slice(1), { ...runOpts, executable })
      : await localOps.run(executable, args, runOpts);
    endExternalCall(id, { ok: true, timedOut: false });
    return result;
  } catch (err) {
    endExternalCall(id, { ok: false, timedOut: isExecTimeout(err) && !isExecAbort(err) });
    // `spawn git ENOENT` tells a new user nothing; say how to install it. `code` is kept for callers that test it.
    if (gitCommand && (err as NodeJS.ErrnoException | null)?.code === "ENOENT") {
      throw Object.assign(new GitMissingError(missingGitCheck()), { code: "ENOENT" });
    }
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

/** Was this stopped by the caller's {@link AbortSignal} rather than failing on its own? */
export function isExecAbort(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const { name, code } = err as { name?: string; code?: string };
  return name === "AbortError" || code === "ABORT_ERR";
}
