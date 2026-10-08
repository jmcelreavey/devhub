import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkoutIsAhead,
  classifyRebuild,
  launchRebuild,
  lockHeldByLiveProcess,
  rebuildStateDir,
  type RebuildFacts,
} from "./checkout-rebuild";

function facts(over: Partial<RebuildFacts> = {}): RebuildFacts {
  return {
    platform: "linux",
    desktop: true,
    wsl: true,
    systemd: false,
    checkout: "/home/me/dev/devhub-private",
    hasDashboard: true,
    hasScript: true,
    runningCommit: "aaa",
    headCommit: "bbb",
    runningIsAncestor: true,
    appData: "/home/me/.local/share/devhub",
    basePayloadDir: "/home/me/.local/share/devhub/runtime/pay",
    basePayloadId: "pay",
    stateDir: "/tmp/devhub-rebuild",
    port: "1337",
    ...over,
  };
}

describe("classifyRebuild", () => {
  it("offers a payload rebuild for the Windows app in WSL when the checkout is ahead", () => {
    const offer = classifyRebuild(facts());
    expect(offer).toMatchObject({ available: true, mode: "payload", checkoutAhead: true });
  });

  it("offers a service rebuild for devhub.service and not for a plain dev server", () => {
    expect(classifyRebuild(facts({ desktop: false, wsl: true, systemd: true })).mode).toBe("service");
    expect(classifyRebuild(facts({ desktop: false, wsl: true, systemd: false })).available).toBe(false);
  });

  it("stays off on macOS and on native Windows", () => {
    expect(classifyRebuild(facts({ platform: "darwin" })).reason).toMatch(/View → Rebuild Dashboard/);
    expect(classifyRebuild(facts({ platform: "win32" })).available).toBe(false);
  });

  it("does not treat a content-only folder as a checkout", () => {
    expect(classifyRebuild(facts({ hasDashboard: false })).available).toBe(false);
    expect(classifyRebuild(facts({ checkout: null })).available).toBe(false);
  });

  it("refuses a payload rebuild when the installed payload was not named", () => {
    expect(classifyRebuild(facts({ basePayloadDir: null })).available).toBe(false);
    expect(classifyRebuild(facts({ basePayloadId: null })).available).toBe(false);
  });

  it("does not call the checkout ahead when the running commit is not an ancestor", () => {
    expect(checkoutIsAhead("aaa", "bbb", false)).toBe(false);
    expect(checkoutIsAhead("aaa", "aaa", true)).toBe(false);
    expect(checkoutIsAhead(null, "bbb", true)).toBe(false);
    expect(classifyRebuild(facts({ runningIsAncestor: false })).checkoutAhead).toBe(false);
  });
});

describe("launchRebuild", () => {
  it("spawns one detached rebuild and will not start a second", () => {
    const spawned: string[][] = [];
    const deps = {
      scriptPath: "/home/me/dev/devhub-private/scripts/checkout-rebuild.mjs",
      lockHeld: () => false,
      spawn: (_cmd: string, args: string[]) => {
        spawned.push(args);
        return { unref() {} };
      },
    };
    const offer = classifyRebuild(facts());
    expect(launchRebuild(offer, true, deps)).toEqual({ ok: true });
    expect(spawned[0]).toEqual(expect.arrayContaining([
      "--mode=payload",
      "--pull",
      "--base-payload=/home/me/.local/share/devhub/runtime/pay",
      "--base-payload-id=pay",
    ]));
    expect(launchRebuild(offer, true, { ...deps, lockHeld: () => true })).toMatchObject({ ok: false, status: 409 });
    expect(spawned).toHaveLength(1);
  });

  it("does not spawn when the platform cannot rebuild", () => {
    let called = false;
    const result = launchRebuild(classifyRebuild(facts({ platform: "darwin" })), false, {
      scriptPath: "x",
      lockHeld: () => false,
      spawn: () => {
        called = true;
        return { unref() {} };
      },
    });
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });
});

describe("rebuild lock", () => {
  it("ignores a lock whose owner is gone and honours a live one", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-rebuild-lock-"));
    const file = path.join(dir, "rebuild.lock");
    fs.writeFileSync(file, JSON.stringify({ pid: 4242 }));
    expect(lockHeldByLiveProcess(file, () => false)).toBe(false);
    expect(lockHeldByLiveProcess(file, (pid) => pid === 4242)).toBe(true);
    expect(lockHeldByLiveProcess(path.join(dir, "missing"))).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("keeps rebuild state out of the repo", () => {
    expect(rebuildStateDir({ NODE_ENV: "test", DEVHUB_CONFIG_DIR: "/tmp/cfg" }, "/home/me")).toBe("/tmp/cfg/rebuild");
    expect(rebuildStateDir({ NODE_ENV: "test" }, "/home/me")).toBe("/home/me/.config/devhub/rebuild");
  });
});
