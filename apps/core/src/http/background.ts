// Keep accepted work alive independently of the request and observe failures.
const state = globalThis as typeof globalThis & { __devhubBackgroundWork?: Set<Promise<void>> };
const pending = state.__devhubBackgroundWork ??= new Set<Promise<void>>();

export function runBackground(label: string, execute: () => Promise<void>): void {
  const timer = setTimeout(() => console.error(`[${label}] background work is still running after 30 minutes`), 30 * 60_000);
  timer.unref?.();
  const work = Promise.resolve().then(execute).catch((error: unknown) => {
    console.error(`[${label}] background work failed`, error);
  }).finally(() => {
    clearTimeout(timer);
    pending.delete(work);
  });
  pending.add(work);
}
