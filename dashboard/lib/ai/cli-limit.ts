/**
 * Cap how many CLI generations run at once.
 *
 * Every agent CLI run is a whole model runtime, and they contend: a trivial
 * prompt measured 15s alone and 33-36s with eight in flight. Firing off eight
 * PR reviews therefore roughly doubled each one's latency and pushed all of
 * them past their time limit together — the failure looked like eight broken
 * runs rather than one queue that was never there.
 *
 * Queueing costs the later jobs some waiting, but each one then runs at close
 * to solo speed and actually finishes. Waiting is not counted against a job's
 * timeout, because the clock starts when its process spawns.
 */
export interface CliLimiter {
  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T>;
  /** Live counts, for diagnostics. */
  stats(): { active: number; queued: number };
}

export function createCliLimiter(max: number): CliLimiter {
  const limit = Math.max(1, Math.floor(max));
  let active = 0;
  const queue: { start: () => void; fail: (err: Error) => void }[] = [];

  const pump = () => {
    while (active < limit && queue.length > 0) {
      const next = queue.shift();
      if (!next) return;
      active += 1;
      next.start();
    }
  };

  return {
    stats: () => ({ active, queued: queue.length }),
    async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      if (signal?.aborted) throw new Error("Generation cancelled.");

      await new Promise<void>((resolve, reject) => {
        const entry = {
          start: resolve,
          fail: reject,
        };
        const onAbort = () => {
          const i = queue.indexOf(entry);
          // Only reject while still waiting; once started the task owns the abort.
          if (i >= 0) {
            queue.splice(i, 1);
            reject(new Error("Generation cancelled."));
          }
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        queue.push(entry);
        pump();
      });

      try {
        return await task();
      } finally {
        active -= 1;
        pump();
      }
    },
  };
}

/** Default cap — high enough to keep a couple of tabs responsive, low enough to avoid thrash. */
export const DEFAULT_MAX_CONCURRENT_CLI = 3;

function envCap(): number {
  const raw = process.env.DEVHUB_AI_MAX_CONCURRENT?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_CONCURRENT_CLI;
}

/** Process-wide limiter shared by every CLI generation. */
export const cliLimiter = createCliLimiter(envCap());
