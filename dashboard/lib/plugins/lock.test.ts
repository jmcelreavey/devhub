import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PluginBusyError, withPluginMutationLock } from "./lock";
import { execExternal } from "../exec-external";

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
  it("serializes independent processes competing to recover a stale owner", async () => {
    const home = scratchHome();
    const lock = path.join(home, "locks", "mutation.lock");
    fs.mkdirSync(lock, { recursive: true });
    fs.writeFileSync(path.join(lock, "dead"), JSON.stringify({ pid: 2_147_483_646 }));
    const modulePath = path.resolve("lib/plugins/lock.ts");
    const worker = `const fs = require('node:fs'); const { withPluginMutationLock } = require(${JSON.stringify(modulePath)});
      withPluginMutationLock(${JSON.stringify(home)}, async () => {
        const marker = ${JSON.stringify(path.join(home, "inside"))};
        fs.writeFileSync(marker, 'inside', { flag: 'wx' });
        await new Promise(resolve => setTimeout(resolve, 40));
        fs.unlinkSync(marker);
      }).catch(err => { console.error(err); process.exitCode = 1; });`;
    await Promise.all(Array.from({ length: 5 }, () => execExternal(process.execPath, ["--import", "tsx", "--eval", worker], { timeoutMs: 15_000 })));
    expect(fs.existsSync(lock)).toBe(false);
  });
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

  it("does not inherit a released ancestor lock in detached async work", async () => {
    const a = scratchHome();
    const b = scratchHome();
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    let later!: Promise<string>;
    await withPluginMutationLock(a, () => withPluginMutationLock(b, async () => {
      later = gate.then(() => withPluginMutationLock(a, async () => "wrong owner", { waitMs: 80 }));
    }));
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const current = withPluginMutationLock(a, async () => {
      entered();
      await new Promise<void>((resolve) => { release = resolve; });
    });
    await ready;
    resume();
    try { await expect(later).rejects.toBeInstanceOf(PluginBusyError); }
    finally { release(); await current; }
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
    fs.mkdirSync(path.join(dir, "mutation.lock"));
    fs.writeFileSync(path.join(dir, "mutation.lock", "dead"), JSON.stringify({ pid: 2_147_483_646, createdAt: new Date().toISOString(), token: "dead" }));
    await expect(withPluginMutationLock(home, async () => "recovered", { waitMs: 500 })).resolves.toBe("recovered");
  });

  it("waits for a live owner instead of stealing the lock", async () => {
    const home = scratchHome();
    const dir = path.join(home, "locks");
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(dir, "mutation.lock"));
    fs.writeFileSync(path.join(dir, "mutation.lock", "someone-else"), JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString(), token: "someone-else" }));
    await expect(withPluginMutationLock(home, async () => "stolen", { waitMs: 100 })).rejects.toBeInstanceOf(PluginBusyError);
    expect(fs.readFileSync(path.join(dir, "mutation.lock", "someone-else"), "utf8")).toContain("someone-else");
  });

  it("does not treat a lock file that is still being written as stale", async () => {
    const home = scratchHome();
    const dir = path.join(home, "locks");
    fs.mkdirSync(dir, { recursive: true });
    // Created a moment ago and not yet filled in.
    fs.writeFileSync(path.join(dir, "mutation.lock"), "");
    await expect(withPluginMutationLock(home, async () => "stolen", { waitMs: 100 })).rejects.toBeInstanceOf(PluginBusyError);
  });

  it("does not infer a dead owner from an unreadable lock's age", async () => {
    const home = scratchHome();
    const dir = path.join(home, "locks");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "mutation.lock");
    fs.writeFileSync(file, "not json");
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(file, old, old);
    await expect(withPluginMutationLock(home, async () => "stolen", { waitMs: 100 })).rejects.toBeInstanceOf(PluginBusyError);
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
