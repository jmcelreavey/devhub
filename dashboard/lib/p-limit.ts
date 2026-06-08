/**
 * Minimal `p-limit` replacement — caps concurrency for async tasks.
 *
 * Used to keep the standup endpoint from spawning hundreds of `gh` / `git`
 * subprocesses in parallel when `MAX_REPOS` is large. Inline here instead of
 * a dependency because the surface area we need is ~10 lines.
 */
export function pLimit(concurrency: number): <T>(task: () => Promise<T>) => Promise<T> {
  if (!Number.isFinite(concurrency) || concurrency < 1) {
    throw new Error(`pLimit: concurrency must be >= 1 (got ${concurrency})`);
  }

  let active = 0;
  const queue: Array<() => void> = [];

  function next() {
    if (active >= concurrency) return;
    const run = queue.shift();
    if (!run) return;
    active++;
    run();
  }

  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        Promise.resolve().then(task).then(
          (value) => {
            active--;
            resolve(value);
            next();
          },
          (err) => {
            active--;
            reject(err);
            next();
          },
        );
      };
      queue.push(run);
      next();
    });
}

/**
 * Run `task(item)` for every item with at most `concurrency` running at once.
 * Returns results in input order. Errors propagate (use `mapSettled` if you
 * want partial success).
 */
export async function pMap<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = pLimit(concurrency);
  return Promise.all(items.map((item, i) => limit(() => task(item, i))));
}

/**
 * Same shape as `Promise.allSettled` but with a concurrency cap. Useful when
 * any single subprocess may hang and we don't want to fail the whole batch.
 */
export async function pMapSettled<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const limit = pLimit(concurrency);
  return Promise.allSettled(items.map((item, i) => limit(() => task(item, i))));
}
