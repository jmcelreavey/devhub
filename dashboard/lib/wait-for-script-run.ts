import type { RunLogPayload } from "./scripts-runner";

export interface WaitForScriptRunOptions {
  /** Called for each streamed log line (default SSE `message` events). */
  onLine?: (line: string) => void;
  /** After SSE disconnects without `done`, poll GET /api/scripts/runs/:id this many times. */
  pollAttempts?: number;
  pollIntervalMs?: number;
}

/** Read exit code from a finished run (live buffer or persisted log). */
export async function fetchScriptRunExitCode(runId: string): Promise<number | null> {
  const r = await fetch(`/api/scripts/runs/${runId}`);
  if (!r.ok) return null;
  const payload = (await r.json()) as Partial<RunLogPayload>;
  return typeof payload.exitCode === "number" ? payload.exitCode : null;
}

async function pollScriptRunExitCode(
  runId: string,
  attempts: number,
  intervalMs: number,
): Promise<number | null> {
  for (let i = 0; i < attempts; i++) {
    const code = await fetchScriptRunExitCode(runId);
    if (code !== null) return code;
    if (i < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  return null;
}

/**
 * Wait for an in-process script run started via POST /api/scripts.
 *
 * Uses SSE on /api/scripts/stream/:runId. If the stream closes before a `done`
 * event (common when the run finishes quickly or the route cold-starts in dev),
 * falls back to polling the persisted run log so callers do not treat a
 * successful run as "stream interrupted".
 */
export function waitForScriptRun(runId: string, opts?: WaitForScriptRunOptions): Promise<number> {
  const pollAttempts = opts?.pollAttempts ?? 12;
  const pollIntervalMs = opts?.pollIntervalMs ?? 200;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      resolve(Number.isNaN(code) ? 1 : code);
    };

    const es = new EventSource(`/api/scripts/stream/${runId}`);

    es.addEventListener("message", (ev) => {
      if (!opts?.onLine) return;
      try {
        opts.onLine(JSON.parse((ev as MessageEvent).data) as string);
      } catch {
        /* ignore malformed line */
      }
    });

    es.addEventListener("done", (ev) => {
      const code = parseInt((ev as MessageEvent).data, 10);
      es.close();
      finish(code);
    });

    es.onerror = () => {
      es.close();
      if (settled) return;
      void (async () => {
        const code = await pollScriptRunExitCode(runId, pollAttempts, pollIntervalMs);
        if (settled) return;
        finish(code ?? 1);
      })();
    };
  });
}
