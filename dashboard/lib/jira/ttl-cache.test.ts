import { describe, expect, it, vi } from "vitest";
import { createTtlCache } from "./ttl-cache";

describe("createTtlCache", () => {
  it("serves a repeat lookup from the cache", async () => {
    const cache = createTtlCache<string>(1_000, () => 0);
    const load = vi.fn().mockResolvedValue("value");
    await expect(cache.get("k", load)).resolves.toBe("value");
    await expect(cache.get("k", load)).resolves.toBe("value");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("shares one in-flight load between concurrent callers", async () => {
    const cache = createTtlCache<string>(1_000, () => 0);
    let resolve!: (value: string) => void;
    const load = vi.fn(() => new Promise<string>((r) => { resolve = r; }));
    const first = cache.get("k", load);
    const second = cache.get("k", load);
    resolve("once");
    await expect(Promise.all([first, second])).resolves.toEqual(["once", "once"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reloads once the TTL has passed", async () => {
    let time = 0;
    const cache = createTtlCache<number>(1_000, () => time);
    const load = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    await expect(cache.get("k", load)).resolves.toBe(1);
    time = 999;
    await expect(cache.get("k", load)).resolves.toBe(1);
    time = 1_000;
    await expect(cache.get("k", load)).resolves.toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not keep a failed load", async () => {
    const cache = createTtlCache<string>(1_000, () => 0);
    const load = vi.fn().mockRejectedValueOnce(new Error("Jira down")).mockResolvedValueOnce("recovered");
    await expect(cache.get("k", load)).rejects.toThrow("Jira down");
    await expect(cache.get("k", load)).resolves.toBe("recovered");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps entries separate by key and can invalidate one or all", async () => {
    const cache = createTtlCache<string>(1_000, () => 0);
    const load = vi.fn(async () => "x");
    await cache.get("a", load);
    await cache.get("b", load);
    expect(load).toHaveBeenCalledTimes(2);
    cache.invalidate("a");
    await cache.get("a", load);
    await cache.get("b", load);
    expect(load).toHaveBeenCalledTimes(3);
    cache.invalidate();
    await cache.get("b", load);
    expect(load).toHaveBeenCalledTimes(4);
  });
});
