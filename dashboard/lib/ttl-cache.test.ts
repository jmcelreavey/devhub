import { describe, it, expect, vi } from "vitest";
import { ttlCache, ttlCacheByKey } from "./ttl-cache";
import type { TtlCached } from "./ttl-cache";

describe("ttlCache", () => {
  it("calls the loader exactly once within the TTL window", async () => {
    const load = vi.fn(async () => "value");
    const cached = ttlCache(load, 1_000);

    expect(await cached()).toBe("value");
    expect(await cached()).toBe("value");
    expect(await cached()).toBe("value");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent calls before the first load resolves", async () => {
    const pending = deferred<string>();
    const load = vi.fn(() => pending.promise);
    const cached = ttlCache(load, 1_000);

    const a = cached();
    const b = cached();
    const c = cached();
    expect(load).toHaveBeenCalledTimes(1);

    pending.resolve("value");
    await expect(Promise.all([a, b, c])).resolves.toEqual(["value", "value", "value"]);
  });

  it("re-invokes the loader after the TTL expires", async () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);

    const load = vi.fn(async () => `value-${now}`);
    const cached = ttlCache(load, 1_000);

    now = 0;
    expect(await cached()).toBe("value-0");

    now = 500;
    expect(await cached()).toBe("value-0");

    now = 2_000;
    expect(await cached()).toBe("value-2000");
    expect(load).toHaveBeenCalledTimes(2);

    vi.restoreAllMocks();
  });

  it("does not cache failures", async () => {
    let attempts = 0;
    const load = vi.fn(async () => {
      attempts++;
      if (attempts === 1) throw new Error("transient");
      return "ok";
    });
    const cached = ttlCache(load, 60_000);

    await expect(cached()).rejects.toThrow("transient");
    expect(await cached()).toBe("ok");
  });

  it("invalidate() clears the cache so the next call re-invokes the loader", async () => {
    const load = vi.fn(async () => "value");
    const cached: TtlCached<string> = ttlCache(load, 60_000);

    expect(await cached()).toBe("value");
    expect(load).toHaveBeenCalledTimes(1);

    cached.invalidate();
    expect(await cached()).toBe("value");
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("ttlCacheByKey", () => {
  it("caches per key independently", async () => {
    const load = vi.fn(async (k: string) => `value-${k}`);
    const cached = ttlCacheByKey(load, 1_000);

    expect(await cached("a")).toBe("value-a");
    expect(await cached("b")).toBe("value-b");
    expect(await cached("a")).toBe("value-a");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent calls per key", async () => {
    const pendingA = deferred<string>();
    const pendingB = deferred<string>();
    const load = vi.fn((key: string) => (key === "a" ? pendingA.promise : pendingB.promise));
    const cached = ttlCacheByKey(load, 1_000);

    const a1 = cached("a");
    const a2 = cached("a");
    const b1 = cached("b");
    expect(load).toHaveBeenCalledTimes(2);

    pendingA.resolve("value-a");
    pendingB.resolve("value-b");
    await expect(Promise.all([a1, a2, b1])).resolves.toEqual(["value-a", "value-a", "value-b"]);
  });
});

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
