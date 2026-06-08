import { describe, it, expect } from "vitest";
import { pLimit, pMap, pMapSettled } from "./p-limit";

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("pLimit", () => {
  it("never runs more than `concurrency` tasks at once", async () => {
    const limit = pLimit(2);
    let active = 0;
    let peak = 0;

    const tasks = Array.from({ length: 10 }, () =>
      limit(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return 1;
      }),
    );

    await Promise.all(tasks);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("drains the queue when a task rejects", async () => {
    const limit = pLimit(1);
    const a = deferred<number>();
    const b = deferred<number>();

    const pa = limit(() => a.promise);
    const pb = limit(() => b.promise);

    a.reject(new Error("boom"));
    await expect(pa).rejects.toThrow("boom");

    b.resolve(7);
    await expect(pb).resolves.toBe(7);
  });

  it("drains the queue when a task throws synchronously", async () => {
    const limit = pLimit(1);
    const first = limit(() => {
      throw new Error("sync boom");
    });
    const second = limit(async () => 7);

    await expect(first).rejects.toThrow("sync boom");
    await expect(second).resolves.toBe(7);
  });

  it("rejects construction with bad concurrency values", () => {
    expect(() => pLimit(0)).toThrow();
    expect(() => pLimit(-1)).toThrow();
  });
});

describe("pMap", () => {
  it("returns results in input order", async () => {
    const out = await pMap([10, 5, 1], 3, async (n) => {
      await new Promise((r) => setTimeout(r, n));
      return n * 2;
    });
    expect(out).toEqual([20, 10, 2]);
  });
});

describe("pMapSettled", () => {
  it("collects fulfilled + rejected results", async () => {
    const out = await pMapSettled([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("bad");
      return n;
    });
    expect(out.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  });
});
