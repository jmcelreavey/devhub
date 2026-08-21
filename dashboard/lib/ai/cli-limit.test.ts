import { describe, expect, it } from "vitest";
import { createCliLimiter } from "./cli-limit";

const defer = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

describe("createCliLimiter", () => {
  it("runs up to the cap at once and queues the rest", async () => {
    const limiter = createCliLimiter(2);
    const gates = [defer(), defer(), defer()];
    let started = 0;
    const tasks = gates.map((g) =>
      limiter.run(async () => {
        started += 1;
        await g.promise;
      }),
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(started).toBe(2);
    expect(limiter.stats()).toEqual({ active: 2, queued: 1 });

    gates[0].resolve();
    await tasks[0];
    expect(started).toBe(3);

    gates[1].resolve();
    gates[2].resolve();
    await Promise.all(tasks);
    expect(limiter.stats()).toEqual({ active: 0, queued: 0 });
  });

  it("frees its slot even when a task throws", async () => {
    const limiter = createCliLimiter(1);
    await expect(limiter.run(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(limiter.stats().active).toBe(0);
    await expect(limiter.run(async () => "next")).resolves.toBe("next");
  });

  it("drops a queued job when its request is aborted", async () => {
    const limiter = createCliLimiter(1);
    const gate = defer();
    const running = limiter.run(async () => { await gate.promise; });
    const ac = new AbortController();
    const queued = limiter.run(async () => "never", ac.signal);
    await Promise.resolve();
    ac.abort();
    await expect(queued).rejects.toThrow(/cancelled/i);
    gate.resolve();
    await running;
    expect(limiter.stats()).toEqual({ active: 0, queued: 0 });
  });

  it("rejects immediately if the signal is already aborted", async () => {
    const limiter = createCliLimiter(2);
    const ac = new AbortController();
    ac.abort();
    await expect(limiter.run(async () => "x", ac.signal)).rejects.toThrow(/cancelled/i);
  });

  it("treats a cap below one as one", async () => {
    const limiter = createCliLimiter(0);
    const gate = defer();
    let started = 0;
    void limiter.run(async () => { started += 1; await gate.promise; });
    void limiter.run(async () => { started += 1; });
    await Promise.resolve();
    expect(started).toBe(1);
    gate.resolve();
  });
});
