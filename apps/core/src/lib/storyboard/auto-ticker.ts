/**
 * Background driver for auto mode. The state machine itself is persisted in
 * each orchestration record (auto-mode.ts); this only pokes it, so a restart
 * picks up exactly where the last write left off. The Storyboard's own poll
 * of /api/storyboard/orchestrate drives it too; both are safe together because
 * every transition is a compare-and-set under the record's lock.
 */
const TICK_MS = 20_000;

interface TickerState {
  timer: ReturnType<typeof setInterval> | null;
  running: boolean;
}

// Pinned to globalThis: instrumentation and API routes can load separate module instances.
const KEY = Symbol.for("devhub.storyboard.autoTicker");
const state: TickerState = ((globalThis as Record<symbol, unknown>)[KEY] as TickerState | undefined) ?? { timer: null, running: false };
(globalThis as Record<symbol, unknown>)[KEY] = state;

export async function runAutoTick(): Promise<void> {
  if (state.running) return;
  state.running = true;
  try {
    const { reconcileOrchestrations } = await import("./orchestrator");
    const executes = await reconcileOrchestrations();
    for (const execute of executes) void execute().catch((error: unknown) => console.error("[storyboard-auto] Jev run failed", error));
  } catch (error) {
    console.error("[storyboard-auto] tick failed", error);
  } finally {
    state.running = false;
  }
}

export function startStoryboardAutoTicker(): void {
  if (state.timer || process.env.DEVHUB_STORYBOARD_AUTO === "0") return;
  state.timer = setInterval(() => void runAutoTick(), TICK_MS);
  state.timer.unref?.();
  void runAutoTick();
}
