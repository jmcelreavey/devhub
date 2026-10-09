import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PluginBusyError, withPluginMutationLock } from "./lock";

const roots: string[] = [];

function scratchHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-plugin-lock-"));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("withPluginMutationLock", () => {
  it("runs concurrent callers one at a time", async () => {
    const home = scratchHome();
    let inside = 0;
    let peak = 0;
    const order: number[] = [];
    await Promise.all([1, 2, 3, 4].map((n) =>
      withPluginMutationLock(home, async () => {
        inside += 1;
        peak = Math.max(peak, inside);
        await wait(15);
        order.push(n);
        inside -= 1;
      })));
    expect(peak).toBe(1);
    expect(order).toHaveLength(4);
  });

  it("lets code inside the lock take it again without waiting on itself", async () => {
    const home = scratchHome();
    const result = await withPluginMutationLock(home, async () => withPluginMutationLock(home, async () => "inner"), { waitMs: 200 });
    expect(result).toBe("inner");
  });

  it("does not let an unrelated concurrent call slip in as if it were nested", async () => {
    const home = scratchHome();
    let releaseFirst: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = withPluginMutationLock(home, async () => { await held; });
    await wait(20);
    await expect(withPluginMutationLock(home, async () => "second", { waitMs: 80 })).rejects.toBeInstanceOf(PluginBusyError);
    releaseFirst();
    await first;
    await expect(withPluginMutationLock(home, async () => "after")).resolves.toBe("after");
  });

  it("releases the lock when the work throws", async () => {
    const home = scratchHome();
    await expect(withPluginMutationLock(home, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(withPluginMutationLock(home, async () => "ok", { waitMs: 200 })).resolves.toBe("ok");
    expect(fs.existsSync(path.join(home, "locks", "mutation.lock"))).toBe(false);
  });

  it("takes over a lock whose owner is gone", async () => {
    const home = scratchHome();
    const dir = path.join(home, "locks");
    fs.mkdirSync(dir, { recursive: true });
    // A pid that cannot belong to a live process.
    fs.writeFileSync(path.join(dir, "mutation.lock"), JSON.stringify({ pid: 2_147_483_646, createdAt: new Date().toISOString(), token: "dead" }));
    await expect(withPluginMutationLock(home, async () => "recovered", { waitMs: 500 })).resolves.toBe("recovered");
  });

  it("waits for a live owner instead of stealing the lock", async () => {
    const home = scratchHome();
    const dir = path.join(home, "locks");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "mutation.lock"), JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString(), token: "someone-else" }));
    await expect(withPluginMutationLock(home, async () => "stolen", { waitMs: 100 })).rejects.toBeInstanceOf(PluginBusyError);
    expect(fs.readFileSync(path.join(dir, "mutation.lock"), "utf8")).toContain("someone-else");
  });

  it("does not treat a lock file that is still being written as stale", async () => {
    const home = scratchHome();
    const dir = path.join(home, "locks");
    fs.mkdirSync(dir, { recursive: true });
    // Created a moment ago and not yet filled in.
    fs.writeFileSync(path.join(dir, "mutation.lock"), "");
    await expect(withPluginMutationLock(home, async () => "stolen", { waitMs: 100 })).rejects.toBeInstanceOf(PluginBusyError);
  });

  it("clears an unreadable lock file once it is clearly abandoned", async () => {
    const home = scratchHome();
    const dir = path.join(home, "locks");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "mutation.lock");
    fs.writeFileSync(file, "not json");
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(file, old, old);
    await expect(withPluginMutationLock(home, async () => "recovered", { waitMs: 500 })).resolves.toBe("recovered");
  });

  it("keeps different plugin homes independent", async () => {
    const a = scratchHome();
    const b = scratchHome();
    let releaseA: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { releaseA = resolve; });
    const first = withPluginMutationLock(a, async () => { await held; });
    await wait(10);
    await expect(withPluginMutationLock(b, async () => "free", { waitMs: 100 })).resolves.toBe("free");
    releaseA();
    await first;
  });
});
