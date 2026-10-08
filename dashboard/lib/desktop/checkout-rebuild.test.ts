import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkoutIsAhead,
  classifyRebuild,
  decideCheckoutAhead,
  launchPlan,
  launchRebuild,
  lockHeldByLiveProcess,
  readRebuildStatus,
  rebuildStateDir,
  SYSTEMD_RUN_TIMEOUT_MS,
  settleRebuildStatus,
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

  it("offers a rebuild when a release SHA is unknown and the checkout commit is newer than the bundle", () => {
    const built = Date.parse("2026-10-01T00:00:00.000Z");
    expect(decideCheckoutAhead({
      running: "publicsha",
      head: "privatehead",
      runningIsAncestor: false,
      runningKnown: false,
      headCommitMs: built + 60_000,
      bundleBuiltAtMs: built,
    })).toBe(true);
    expect(decideCheckoutAhead({
      running: "publicsha",
      head: "privatehead",
      runningIsAncestor: false,
      runningKnown: false,
      headCommitMs: built,
      bundleBuiltAtMs: built,
    })).toBe(false);
    expect(decideCheckoutAhead({
      running: "publicsha",
      head: "privatehead",
      runningIsAncestor: false,
      runningKnown: false,
      headCommitMs: built - 60_000,
      bundleBuiltAtMs: built,
    })).toBe(false);
    expect(classifyRebuild(facts({
      runningCommit: "publicsha",
      headCommit: "privatehead",
      runningIsAncestor: false,
      runningKnown: false,
      headCommitMs: built + 60_000,
      bundleBuiltAtMs: built,
    })).checkoutAhead).toBe(true);
  });
});

describe("launchRebuild", () => {
  it.each([true, false])("only bootstraps pulls from the installed payload (pull=%s)", async (pull) => {
    const spawned: string[][] = [];
    const offer = classifyRebuild(facts());
    const bundled = "/home/me/.local/share/devhub/runtime/pay/resources/scripts/checkout-rebuild.mjs";
    const checkoutScript = "/home/me/dev/devhub-private/scripts/checkout-rebuild.mjs";
    await launchRebuild(offer, pull, {
      scriptPath: checkoutScript,
      existsSync: (file) => file === bundled,
      lockHeld: () => false,
      systemd: false,
      spawn: (_cmd, args) => { spawned.push(args); return { unref() {} }; },
    });
    expect(spawned[0][0]).toBe(pull ? bundled : checkoutScript);
    expect(spawned[0]).toContain("--launcher=detached");
  });

  it("falls back to the checkout bootstrap for older installed payloads", async () => {
    let script = "";
    await launchRebuild(classifyRebuild(facts()), true, {
      scriptPath: "/checkout/scripts/checkout-rebuild.mjs",
      existsSync: () => false,
      lockHeld: () => false,
      systemd: false,
      spawn: (_cmd, args) => { script = args[0]; return { unref() {} }; },
    });
    expect(script).toBe("/checkout/scripts/checkout-rebuild.mjs");
  });
  it("spawns one detached rebuild and will not start a second", async () => {
    const spawned: string[][] = [];
    const deps = {
      scriptPath: "/home/me/dev/devhub-private/scripts/checkout-rebuild.mjs",
      lockHeld: () => false,
      systemd: false,
      spawn: (_cmd: string, args: string[]) => {
        spawned.push(args);
        return { unref() {} };
      },
    };
    const offer = classifyRebuild(facts());
    expect(await launchRebuild(offer, true, deps)).toMatchObject({ ok: true, launcher: "detached" });
    expect(spawned[0]).toEqual(expect.arrayContaining([
      "--mode=payload",
      "--pull",
      "--base-payload=/home/me/.local/share/devhub/runtime/pay",
      "--base-payload-id=pay",
    ]));
    expect(await launchRebuild(offer, true, { ...deps, lockHeld: () => true })).toMatchObject({ ok: false, status: 409 });
    expect(spawned).toHaveLength(1);
  });

  it("does not spawn when the platform cannot rebuild", async () => {
    let called = false;
    const result = await launchRebuild(classifyRebuild(facts({ platform: "darwin" })), false, {
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

  it("puts only an allowlist on the systemd-run argv and waits for the start job", async () => {
    const execs: { cmd: string; args: string[]; timeout?: number }[] = [];
    const spawns: { cmd: string }[] = [];
    const offer = classifyRebuild(facts());
    const env = {
      NODE_ENV: "production",
      HOME: "/home/me",
      PATH: "/usr/bin",
      USER: "me",
      LC_ALL: "C.UTF-8",
      LC_SECRET: "lc-secret-value",
      XDG_RUNTIME_DIR: "/run/user/1000",
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
      WSL_DISTRO_NAME: "Ubuntu",
      NVM_DIR: "/home/me/.nvm",
      SSH_AUTH_SOCK: "/run/user/1000/ssh-agent.sock",
      DEVHUB_SOURCE_COMMIT: "abc123def",
      DEVHUB_API_KEY: "devhub-api-key-value",
      OPENAI_API_KEY: "sk-openai-secret-value",
      JIRA_API_TOKEN: "jira-token-value",
      GITHUB_TOKEN: "ghp-should-not-appear",
      AWS_SECRET_ACCESS_KEY: "aws-secret-value",
      NOT_A_REAL_VAR: "arbitrary-non-allowlisted",
      npm_config_omit: "dev",
    } as NodeJS.ProcessEnv;
    expect(await launchRebuild(offer, false, {
      scriptPath: "/home/me/dev/devhub-private/scripts/checkout-rebuild.mjs",
      lockHeld: () => false,
      execPath: "/opt/node22/bin/node",
      now: 42,
      env,
      systemd: true,
      execFile: async (cmd, args, opts) => {
        execs.push({ cmd, args, timeout: opts.timeout });
        return { stdout: "", stderr: "" };
      },
      spawn: (cmd) => {
        spawns.push({ cmd });
        return { unref() {} };
      },
    })).toEqual({ ok: true, launcher: "systemd-run" });
    expect(spawns).toHaveLength(0);
    expect(execs[0]?.cmd).toBe("systemd-run");
    expect(execs[0]?.timeout).toBe(SYSTEMD_RUN_TIMEOUT_MS);
    const argv = execs[0]?.args.join("\n") ?? "";
    for (const leak of [
      "sk-openai-secret-value",
      "jira-token-value",
      "ghp-should-not-appear",
      "aws-secret-value",
      "devhub-api-key-value",
      "lc-secret-value",
      "arbitrary-non-allowlisted",
      "OPENAI_API_KEY",
      "JIRA_API_TOKEN",
      "GITHUB_TOKEN",
      "AWS_SECRET_ACCESS_KEY",
      "DEVHUB_API_KEY",
      "NOT_A_REAL_VAR",
      "LC_SECRET",
      "NODE_ENV",
      "npm_config_omit",
      "/usr/bin/env",
    ]) {
      expect(argv, leak).not.toContain(leak);
    }
    expect(execs[0]?.args).toEqual(expect.arrayContaining([
      "--user",
      "--collect",
      "--unit=devhub-rebuild-42",
      "--working-directory=/home/me/dev/devhub-private",
      "--setenv=HOME=/home/me",
      "--setenv=PATH=/opt/node22/bin:/usr/bin",
      "--setenv=DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus",
      "--setenv=DEVHUB_SOURCE_COMMIT=abc123def",
      "--setenv=LC_ALL=C.UTF-8",
      "--setenv=WSL_DISTRO_NAME=Ubuntu",
      "--setenv=XDG_RUNTIME_DIR=/run/user/1000",
      "--setenv=NVM_DIR=/home/me/.nvm",
      "--setenv=SSH_AUTH_SOCK=/run/user/1000/ssh-agent.sock",
      "--setenv=USER=me",
      "/opt/node22/bin/node",
      "--launcher=systemd-run",
    ]));
    expect(execs[0]?.args).not.toContain("-i");
  });

  it("falls back to a detached process when systemd-run exits non-zero or cannot start", async () => {
    const offer = classifyRebuild(facts());
    const env = {
      HOME: "/home/me",
      PATH: "/usr/bin",
      OPENAI_API_KEY: "sk-openai-secret-value",
      NODE_ENV: "production",
    } as NodeJS.ProcessEnv;
    async function run(execFile: (cmd: string, args: string[], opts: { cwd?: string; timeout?: number }) => Promise<{ stdout: string; stderr: string }>) {
      const spawns: { cmd: string; args: string[]; env?: NodeJS.ProcessEnv }[] = [];
      const logs: string[] = [];
      const result = await launchRebuild(offer, false, {
        scriptPath: "/home/me/dev/devhub-private/scripts/checkout-rebuild.mjs",
        lockHeld: () => false,
        execPath: "/opt/node22/bin/node",
        now: 7,
        env,
        systemd: true,
        log: (line) => logs.push(line),
        execFile,
        spawn: (cmd, args, opts) => {
          spawns.push({ cmd, args, env: opts.env });
          return { unref() {} };
        },
      });
      return { result, spawns, logs };
    }
    const refused = await run(async () => {
      throw Object.assign(new Error("Command failed"), { code: 1, stderr: "Failed to connect to bus\n" });
    });
    expect(refused.result).toEqual({ ok: true, launcher: "detached" });
    expect(refused.spawns[0]?.cmd).toBe("/opt/node22/bin/node");
    expect(refused.spawns[0]?.args).toContain("--launcher=detached");
    expect(refused.spawns[0]?.args).not.toContain("--launcher=systemd-run");
    expect(refused.spawns[0]?.env?.NODE_ENV).toBeUndefined();
    expect(refused.spawns[0]?.env?.PATH?.startsWith("/opt/node22/bin")).toBe(true);
    expect(refused.spawns[0]?.env?.OPENAI_API_KEY).toBe("sk-openai-secret-value");
    expect(refused.logs[0]).toMatch(/Failed to connect to bus/);
    expect(refused.logs[0]).toMatch(/detached/);

    const missing = await run(async () => {
      throw Object.assign(new Error("spawn systemd-run ENOENT"), { code: "ENOENT" });
    });
    expect(missing.result).toEqual({ ok: true, launcher: "detached" });
    expect(missing.spawns).toHaveLength(1);
    expect(missing.logs[0]).toMatch(/ENOENT/);
  });

  it("passes a checkout path with spaces as --working-directory", () => {
    const planned = launchPlan({
      systemd: true,
      execPath: "/opt/node22/bin/node",
      scriptArgs: ["script"],
      env: { HOME: "/home/me", OPENAI_API_KEY: "sk-openai-secret-value", NODE_ENV: "test" },
      checkout: "/home/me/My Checkout",
      unit: "devhub-rebuild-1",
    });
    expect(planned.args).toContain("--working-directory=/home/me/My Checkout");
    expect(planned.args.join("\n")).not.toContain("sk-openai-secret-value");
    expect(planned.args.join("\n")).not.toContain("WorkingDirectory");
    expect(planned.args.join("\n")).not.toContain("OPENAI_API_KEY");
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
    expect(rebuildStateDir({ NODE_ENV: "test", DEVHUB_CONFIG_DIR: "/tmp/cfg" }, "/home/me", { mode: "service", port: "1337" }))
      .toBe("/tmp/cfg/rebuild/service/1337");
    expect(rebuildStateDir({ NODE_ENV: "test", DEVHUB_CONFIG_DIR: "/tmp/cfg" }, "/home/me", { mode: "payload", port: "1338" }))
      .toBe("/tmp/cfg/rebuild/payload/1338");
  });

  it("reports a running rebuild with a dead owner as interrupted", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-rebuild-status-"));
    fs.writeFileSync(path.join(dir, "rebuild-status.json"), JSON.stringify({
      state: "running",
      phase: "restart",
      phases: [{ id: "restart", label: "Restart devhub.service", state: "running" }],
      error: null,
    }));
    fs.writeFileSync(path.join(dir, "rebuild.lock"), JSON.stringify({ pid: 4242 }));
    expect(settleRebuildStatus(dir, () => false)?.state).toBe("interrupted");
    expect(readRebuildStatus(dir)?.state).toBe("interrupted");
    expect(readRebuildStatus(dir)?.error).toMatch(/interrupted/);
    expect(readRebuildStatus(dir)?.phases[0]?.state).toBe("interrupted");
    fs.writeFileSync(path.join(dir, "rebuild-status.json"), JSON.stringify({
      state: "running", phase: "build", phases: [], error: null,
    }));
    expect(settleRebuildStatus(dir, () => true)?.state).toBe("running");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
