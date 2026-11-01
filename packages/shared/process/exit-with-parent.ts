/**
 * Safety net for stdio servers (MCP and friends): exit once nobody can talk to
 * us any more. A client that dies without closing its pipes, or a wrapper (tsx,
 * npx) killed with SIGKILL, would otherwise leave the server running forever,
 * re-parented to launchd.
 *
 * Two signals, either is enough:
 * - stdin ends or closes: the client hung up.
 * - our parent pid changes: whoever spawned us is gone.
 *
 * Listening for `end`/`close` does not start reading stdin, so this never
 * changes how the server consumes its input.
 */
export interface ExitWithParentOptions {
  pollMs?: number;
  stdin?: NodeJS.ReadableStream;
  /** Off for a proxy that already shuts down its child when stdin ends. */
  watchStdin?: boolean;
  getPpid?: () => number;
  exit?: (code: number) => void;
  log?: (message: string) => void;
}

export function exitWithParent(options: ExitWithParentOptions = {}): () => void {
  const {
    pollMs = 5_000,
    stdin = process.stdin,
    watchStdin = true,
    getPpid = () => process.ppid,
    exit = (code) => process.exit(code),
    log = (message) => console.error(message),
  } = options;
  const parent = getPpid();
  let done = false;
  const stop = (reason: string) => {
    if (done) return;
    done = true;
    cleanup();
    log(`[exit-with-parent] ${reason}; exiting`);
    exit(0);
  };
  const onEnd = () => stop("stdin closed");
  if (watchStdin) {
    stdin.once("end", onEnd);
    stdin.once("close", onEnd);
  }
  const timer = setInterval(() => {
    const current = getPpid();
    if (current !== parent) stop(`parent ${parent} is gone`);
  }, pollMs);
  timer.unref?.();
  function cleanup() {
    clearInterval(timer);
    stdin.removeListener("end", onEnd);
    stdin.removeListener("close", onEnd);
  }
  return cleanup;
}
