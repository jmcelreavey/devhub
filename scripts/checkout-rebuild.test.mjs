import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runRebuild, assertNpm10, acquireLock, optionsFromArgs, afterPullArgs, REBUILD_CODE } from "./checkout-rebuild.mjs";
import { lockfilesMatchIgnoringLibc, shouldRestoreTsconfig } from "../dashboard/lib/desktop/build-env.mjs";

const FORBIDDEN_GIT = new Set(["reset", "stash", "clean", "rebase"]);


test("handover neither keeps a dead child's lock nor overwrites a concurrent owner's status", async (context) => {
  for (const ownerAlive of [false, true]) {
    const w = world();
    context.after(() => fs.rmSync(w.root, { recursive: true, force: true }));
    const base = runner(gitState({ counts: "2\t0", changedCode: REBUILD_CODE[0] }));
    const lockFile = path.join(w.stateDir, "rebuild.lock");
    const statusFile = path.join(w.stateDir, "rebuild-status.json");
    const run = async (cmd, args, opts) => {
      if (args[0] === path.join(w.checkout, "scripts", "checkout-rebuild.mjs")) {
        fs.writeFileSync(lockFile, JSON.stringify({ pid: 999003 }));
        fs.writeFileSync(statusFile, JSON.stringify({ state: "running", launcher: "other" }));
        return { code: 127, stdout: "", stderr: "child failed" };
      }
      return base.run(cmd, args, opts);
    };
    const status = await runRebuild({ mode: "service", checkout: w.checkout, stateDir: w.stateDir, pull: true }, serviceDeps(run, { alive: (pid) => ownerAlive && pid === 999003 }));
    assert.equal(status.state, ownerAlive ? "refused" : "failed");
    assert.equal(fs.existsSync(lockFile), ownerAlive);
    const final = JSON.parse(fs.readFileSync(statusFile, "utf8"));
    assert.equal(final.state, ownerAlive ? "running" : "failed");
    if (ownerAlive) assert.equal(final.launcher, "other");
  }
});


test("unchanged rebuild code or an unchanged HEAD does not re-exec", async (context) => {
  for (const state of [{ counts: "2\t0", changedCode: "" }, { counts: "0\t0", changedCode: REBUILD_CODE[0] }]) {
    const w = world();
    context.after(() => fs.rmSync(w.root, { recursive: true, force: true }));
    const { run, calls } = runner(gitState(state), { onBuild: () => wroteRebuild(w.dashboard) });
    const status = await runRebuild({ mode: "service", checkout: w.checkout, stateDir: w.stateDir, pull: true }, serviceDeps(run));
    assert.equal(status.state, "succeeded");
    assert.equal(calls.some((call) => call.args[0] === path.join(w.checkout, "scripts", "checkout-rebuild.mjs")), false);
  }
});

test("handover preserves the updated child's exit code and final failure status", async (context) => {
  const w = world();
  context.after(() => fs.rmSync(w.root, { recursive: true, force: true }));
  const base = runner(gitState({ counts: "2\t0", changedCode: REBUILD_CODE[0] }), { fail: { build: 1 } });
  const run = async (cmd, args, opts) => {
    if (args[0] === path.join(w.checkout, "scripts", "checkout-rebuild.mjs")) {
      const child = await runRebuild(optionsFromArgs(args.slice(1)), serviceDeps(base.run, { pid: 999002 }));
      assert.equal(child.state, "failed");
      return { code: 7, stdout: "", stderr: "" };
    }
    return base.run(cmd, args, opts);
  };
  const status = await runRebuild({ mode: "service", checkout: w.checkout, stateDir: w.stateDir, pull: true }, serviceDeps(run));
  assert.equal(status.state, "failed");
  assert.equal(status.exitCode, 7);
  assert.equal(fs.existsSync(path.join(w.stateDir, "rebuild.lock")), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(w.stateDir, "rebuild-status.json"), "utf8")).state, "failed");
});

test("failed staged-payload health does not publish a marker or replace the existing record", async (context) => {
  const w = world();
  context.after(() => fs.rmSync(w.root, { recursive: true, force: true }));
  const basePayloadDir = path.join(w.root, "base");
  fs.mkdirSync(path.join(basePayloadDir, "runtime"), { recursive: true });
  fs.writeFileSync(path.join(basePayloadDir, "runtime", "node"), "node");
  fs.mkdirSync(path.join(w.checkout, "desktop", "wsl"), { recursive: true });
  fs.writeFileSync(path.join(w.checkout, "desktop", "wsl", "devhub-wsl-launch.sh"), "#!/bin/sh\n");
  const recordFile = path.join(w.appData, "config", "local-payload.json");
  fs.mkdirSync(path.dirname(recordFile), { recursive: true });
  const original = '{"dir":"old","commit":"old","basePayloadId":"pay"}';
  fs.writeFileSync(recordFile, original);
  const { run } = runner(gitState(), { onBuild: () => {
    for (const name of ["server", "services", "resources"]) fs.mkdirSync(path.join(w.checkout, "desktop", "staging", name), { recursive: true });
  } });
  let partial;
  const status = await runRebuild({ mode: "payload", checkout: w.checkout, stateDir: w.stateDir, pull: false, appData: w.appData, basePayloadDir, basePayloadId: "pay" }, serviceDeps(run, {
    smokePayload: async (dir) => {
      partial = dir;
      assert.equal(fs.existsSync(path.join(dir, ".complete")), false);
      throw new Error("Staged checkout payload failed its startup health check");
    },
  }));
  assert.equal(status.state, "failed");
  assert.match(status.error, /startup health check/);
  assert.equal(status.restartRequired, false);
  assert.equal(fs.readFileSync(recordFile, "utf8"), original);
  assert.equal(fs.existsSync(partial), false);
  assert.equal(fs.existsSync(partial.replace(/\.partial$/, "")), false);
});


test("updated rebuild code re-execs once in the same runner with lock and launcher handover", async (context) => {
  for (const changedCode of REBUILD_CODE) {
    const w = world();
    context.after(() => fs.rmSync(w.root, { recursive: true, force: true }));
    const git = gitState({ counts: "2\t0", changedCode });
    const base = runner(git, { onBuild: () => wroteRebuild(w.dashboard) });
    let children = 0;
    const run = async (cmd, args, opts) => {
      if (args[0] === path.join(w.checkout, "scripts", "checkout-rebuild.mjs")) {
        children++;
        assert.equal(cmd, process.execPath);
        assert.equal(opts.cwd, w.checkout);
        assert.equal(fs.existsSync(path.join(w.stateDir, "rebuild.lock")), false);
        assert.equal(args.includes("--pull"), false);
        const child = await runRebuild(optionsFromArgs(args.slice(1)), serviceDeps(base.run, { pid: 999002 }));
        assert.equal(child.phases.find((phase) => phase.id === "pull").state, "done");
        return { code: child.state === "succeeded" ? 0 : 7, stdout: "", stderr: "" };
      }
      return base.run(cmd, args, opts);
    };
    const status = await runRebuild({ mode: "service", checkout: w.checkout, stateDir: w.stateDir, pull: true, launcher: "systemd-run" }, serviceDeps(run));
    assert.equal(children, 1);
    assert.equal(status.state, "succeeded");
    assert.equal(status.exitCode, 0);
    assert.equal(status.launcher, "systemd-run");
    assert.equal(base.calls.filter((call) => call.cmd === "git" && call.args[0] === "pull").length, 1);
    assert.equal(fs.existsSync(path.join(w.stateDir, "rebuild.lock")), false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(w.stateDir, "rebuild-status.json"), "utf8")).state, "succeeded");
  }
});

test("handover keeps the parent's pull output and hand-over line in rebuild.log", async (context) => {
  const w = world();
  context.after(() => fs.rmSync(w.root, { recursive: true, force: true }));
  const base = runner(gitState({ counts: "2\t0", changedCode: REBUILD_CODE[0] }), { onBuild: () => wroteRebuild(w.dashboard) });
  const run = async (cmd, args, opts) => {
    if (args[0] === path.join(w.checkout, "scripts", "checkout-rebuild.mjs")) {
      const child = await runRebuild(optionsFromArgs(args.slice(1)), serviceDeps(base.run, { pid: 999002 }));
      assert.equal(child.state, "succeeded");
      assert.equal(child.phases.find((phase) => phase.id === "pull").state, "done");
      return { code: 0, stdout: "", stderr: "" };
    }
    if (cmd === "git" && args[0] === "pull") opts.log("Updating abc123..pulledcommit12 (Fast-forward)");
    return base.run(cmd, args, opts);
  };
  const status = await runRebuild({ mode: "service", checkout: w.checkout, stateDir: w.stateDir, pull: true }, serviceDeps(run));
  assert.equal(status.state, "succeeded");
  const log = fs.readFileSync(path.join(w.stateDir, "rebuild.log"), "utf8");
  const order = [
    "rebuild started (service",
    "Updating abc123..pulledcommit12 (Fast-forward)",
    "Handing over to the checkout's own rebuild script after the pull.",
    "rebuild continued by the checkout script (service",
    "--- Build",
  ].map((needle) => log.indexOf(needle));
  assert.ok(order.every((index) => index >= 0), `missing a line in rebuild.log:\n${log}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, `rebuild.log lines out of order:\n${log}`);
});

test("the installed bundle's copy hands over to the checkout script even when nothing was pulled", async (context) => {
  const w = world();
  context.after(() => fs.rmSync(w.root, { recursive: true, force: true }));
  const checkoutScript = path.join(w.checkout, "scripts", "checkout-rebuild.mjs");
  fs.mkdirSync(path.dirname(checkoutScript), { recursive: true });
  fs.writeFileSync(checkoutScript, "// checkout copy\n");
  const base = runner(gitState({ counts: "0\t0" }), { onBuild: () => wroteRebuild(w.dashboard) });
  let children = 0;
  const run = async (cmd, args, opts) => {
    if (args[0] === checkoutScript) {
      children++;
      const child = await runRebuild(optionsFromArgs(args.slice(1)), serviceDeps(base.run, { pid: 999002 }));
      return { code: child.state === "succeeded" ? 0 : 7, stdout: "", stderr: "" };
    }
    return base.run(cmd, args, opts);
  };
  const options = { mode: "service", checkout: w.checkout, stateDir: w.stateDir, pull: true };
  const status = await runRebuild(options, serviceDeps(run, { selfPath: "/installed/resources/scripts/checkout-rebuild.mjs" }));
  assert.equal(children, 1);
  assert.equal(status.state, "succeeded");
  const own = await runRebuild(options, serviceDeps(run, { selfPath: checkoutScript }));
  assert.equal(children, 1);
  assert.equal(own.state, "succeeded");
});

test("an after-pull guard marks pull done without fetching or re-executing", async (context) => {
  const w = world();
  context.after(() => fs.rmSync(w.root, { recursive: true, force: true }));
  const { run, calls } = runner(gitState({ counts: "2\t0", changedCode: REBUILD_CODE[0] }), { onBuild: () => wroteRebuild(w.dashboard) });
  const status = await runRebuild({ mode: "service", checkout: w.checkout, stateDir: w.stateDir, pull: true, afterPull: "abc123" }, serviceDeps(run));
  assert.equal(status.state, "succeeded");
  assert.equal(status.phases.find((phase) => phase.id === "pull").state, "done");
  assert.equal(calls.some((call) => call.cmd === "git" && ["fetch", "pull", "diff"].includes(call.args[0])), false);
});

test("a failed handover reports failure and leaves no lock owned by the parent", async (context) => {
  const w = world();
  context.after(() => fs.rmSync(w.root, { recursive: true, force: true }));
  const base = runner(gitState({ counts: "2\t0", changedCode: REBUILD_CODE[0] }));
  const run = async (cmd, args, opts) => {
    if (args[0] === path.join(w.checkout, "scripts", "checkout-rebuild.mjs")) throw new Error("could not spawn updated script");
    return base.run(cmd, args, opts);
  };
  const status = await runRebuild({ mode: "service", checkout: w.checkout, stateDir: w.stateDir, pull: true }, serviceDeps(run));
  assert.equal(status.state, "failed");
  assert.match(status.error, /could not spawn/);
  assert.equal(fs.existsSync(path.join(w.stateDir, "rebuild.lock")), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(w.stateDir, "rebuild-status.json"), "utf8")).state, "failed");
});

test("CLI options retain launcher and the after-pull guard disables another pull", () => {
  const argv = ["--mode=payload", "--checkout=/checkout", "--state=/state", "--app-data=/data", "--base-payload=/base", "--base-payload-id=pay", "--port=1347", "--launcher=systemd-run", "--pull"];
  const parsed = optionsFromArgs(argv);
  assert.equal(parsed.launcher, "systemd-run");
  assert.equal(parsed.pull, true);
  assert.equal(parsed.port, "1347");
  const handedOver = afterPullArgs(argv, "abc123");
  assert.equal(handedOver.includes("--pull"), false);
  assert.equal(optionsFromArgs([...handedOver, "--pull"]).pull, false);
  assert.equal(optionsFromArgs(handedOver).afterPull, "abc123");
  assert.equal(optionsFromArgs(handedOver).basePayloadDir, "/base");
});

test("releasing the parent lock twice never removes the child's lock", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-lock-handover-"));
  try {
    const file = path.join(root, "rebuild.lock");
    const parent = acquireLock(file, { pid: 1001, alive: () => false });
    parent.release();
    const child = acquireLock(file, { pid: 1002, alive: () => false });
    parent.release();
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).pid, 1002);
    child.release();
    assert.equal(fs.existsSync(file), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function world() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-rebuild-"));
  const checkout = path.join(root, "checkout");
  const dashboard = path.join(checkout, "dashboard");
  fs.mkdirSync(path.join(checkout, ".git"), { recursive: true });
  fs.mkdirSync(path.join(dashboard, ".next"), { recursive: true });
  fs.writeFileSync(path.join(dashboard, ".next", "BUILD_ID"), "old\n");
  fs.writeFileSync(path.join(dashboard, "package-lock.json"), "{}\n");
  fs.mkdirSync(path.join(dashboard, "node_modules"), { recursive: true });
  return {
    root,
    checkout,
    dashboard,
    stateDir: path.join(root, "state"),
    appData: path.join(root, "app-data"),
  };
}

function gitState(over = {}) {
  return {
    branch: "main",
    head: "abc123def4567890abcdef",
    dirty: "",
    counts: "0\t0",
    countCode: 0,
    ...over,
  };
}

function runner(git, { fail = {}, onBuild } = {}) {
  const calls = [];
  async function run(cmd, args, opts) {
    calls.push({ cmd, args: [...args], env: opts?.env });
    if (cmd === "git" && FORBIDDEN_GIT.has(args[0])) {
      throw new Error(`rebuild must not run git ${args[0]}`);
    }
    if (cmd === "git" && args[0] === "branch") return { code: 0, stdout: `${git.branch}\n`, stderr: "" };
    if (cmd === "git" && args[0] === "rev-parse") return { code: 0, stdout: `${git.head}\n`, stderr: "" };
    if (cmd === "git" && args[0] === "checkout") {
      assert.equal(args[1], "--");
      assert.match(String(args[2]), /package-lock\.json$|tsconfig\.json$/);
      git.restored = args[2];
      return { code: 0, stdout: "", stderr: "" };
    }
    if (cmd === "git" && args[0] === "show") {
      const spec = String(args[1] ?? "").replace(/^HEAD:/, "");
      if (!git.show || git.show[spec] === undefined) return { code: 1, stdout: "", stderr: "" };
      return { code: 0, stdout: git.show[spec], stderr: "" };
    }
    if (cmd === "git" && args[0] === "status") {
      const spec = args.indexOf("--");
      if (spec !== -1) {
        const file = args[spec + 1];
        if (String(file).endsWith("tsconfig.json")) return { code: 0, stdout: git.tsconfigDirty ?? "", stderr: "" };
        return { code: 0, stdout: git.lockfiles?.[file] ?? "", stderr: "" };
      }
      return { code: 0, stdout: git.dirty, stderr: "" };
    }
    if (cmd === "git" && args[0] === "rev-list") return { code: git.countCode, stdout: `${git.counts}\n`, stderr: "" };
    if (cmd === "git" && args[0] === "fetch") return { code: fail.fetch ?? 0, stdout: "", stderr: "" };
    if (cmd === "git" && args[0] === "diff") return { code: 0, stdout: git.changedCode ?? "", stderr: "" };
    if (cmd === "git" && args[0] === "pull") {
      assert.deepEqual(args, ["pull", "--ff-only"]);
      if (fail.pull) return { code: fail.pull, stdout: "", stderr: "" };
      git.counts = "0\t0";
      git.head = "pulledcommit12abcdef";
      return { code: 0, stdout: "", stderr: "" };
    }
    if (cmd === "npm" && args.includes("--ignore-scripts")) return { code: 0, stdout: "", stderr: "" };
    if (cmd === "npm" && (args[0] === "install" || args[0] === "ci")) return { code: fail.install ?? 0, stdout: "", stderr: "" };
    if (cmd === "npm" && args[0] === "run" && args[1] === "build") {
      if (fail.build) return { code: fail.build, stdout: "", stderr: "build broke\n" };
      onBuild?.(opts);
      return { code: 0, stdout: "", stderr: "" };
    }
    if (cmd === "systemctl") return { code: fail.systemctl ?? 0, stdout: "", stderr: "" };
    if (args.some((arg) => String(arg).endsWith("stage-resources.mjs"))) return { code: 0, stdout: "", stderr: "" };
    if (args.some((arg) => String(arg).endsWith("stage-dashboard.mjs"))) {
      if (fail.build) return { code: fail.build, stdout: "", stderr: "" };
      onBuild?.(opts);
      return { code: 0, stdout: "", stderr: "" };
    }
    return { code: 1, stdout: "", stderr: `unmocked ${cmd} ${args.join(" ")}` };
  }
  return { run, calls };
}

function wroteRebuild(dashboard) {
  const dist = path.join(dashboard, ".next-rebuild");
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, "BUILD_ID"), "new\n");
}

function serviceDeps(run, extra = {}) {
  return {
    run,
    healthy: async () => true,
    sleep: async () => {},
    pid: 999001,
    alive: () => false,
    npmInvoke: { cmd: "npm", prefix: [] },
    smokePayload: async () => {},
    ...extra,
  };
}

test("a service rebuild leaves the live build alone when the build fails", async () => {
  const w = world();
  const git = gitState();
  const { run, calls } = runner(git, { fail: { build: 1 } });
  const status = await runRebuild(
    { mode: "service", checkout: w.checkout, stateDir: w.stateDir, pull: false },
    serviceDeps(run),
  );
  assert.equal(status.state, "failed");
  assert.equal(status.rolledBack, false);
  assert.equal(fs.readFileSync(path.join(w.dashboard, ".next", "BUILD_ID"), "utf8"), "old\n");
  assert.equal(fs.existsSync(path.join(w.dashboard, ".next-rebuild")), false);
  assert.equal(calls.some((call) => call.cmd === "systemctl"), false);
  fs.rmSync(w.root, { recursive: true, force: true });
});

test("a failed restart puts the previous build back", async () => {
  const w = world();
  const git = gitState();
  const { run } = runner(git, {
    fail: { systemctl: 1 },
    onBuild: () => wroteRebuild(w.dashboard),
  });
  const status = await runRebuild(
    { mode: "service", checkout: w.checkout, stateDir: w.stateDir, pull: false, healthTimeoutMs: 0 },
    serviceDeps(run, { healthy: async () => false }),
  );
  assert.equal(status.state, "failed");
  assert.equal(status.rolledBack, true);
  assert.match(status.error, /previous build was restored/);
  assert.equal(fs.readFileSync(path.join(w.dashboard, ".next", "BUILD_ID"), "utf8"), "old\n");
  fs.rmSync(w.root, { recursive: true, force: true });
});

test("a clean service rebuild switches to the new build and does not rewrite git", async () => {
  const w = world();
  const git = gitState({ counts: "2\t0" });
  const { run, calls } = runner(git, { onBuild: () => wroteRebuild(w.dashboard) });
  const status = await runRebuild(
    { mode: "service", checkout: w.checkout, stateDir: w.stateDir, pull: true },
    serviceDeps(run),
  );
  assert.equal(status.state, "succeeded");
  assert.equal(fs.readFileSync(path.join(w.dashboard, ".next", "BUILD_ID"), "utf8"), "new\n");
  assert.equal(calls.filter((call) => call.cmd === "git" && call.args[0] === "pull").length, 1);
  assert.equal(calls.some((call) => call.cmd === "git" && call.args[0] === "fetch"), true);
  const build = JSON.parse(fs.readFileSync(path.join(w.dashboard, ".next", "devhub-build.json"), "utf8"));
  assert.equal(build.commit, "pulledcommit12abcdef");
  const buildCall = calls.find((call) => call.cmd === "npm" && call.args[1] === "build");
  assert.equal(buildCall.env.DEVHUB_DIST_DIR, ".next-rebuild");
  assert.equal(buildCall.env.DEVHUB_VERIFY_BUILD, "");
  assert.deepEqual(
    calls.filter((call) => call.cmd === "npm" && call.args[0] === "install").map((call) => call.args),
    [["install", "--include=dev", "--no-audit", "--no-fund"]],
  );
  assert.equal(calls.some((call) => call.args.includes("--no-package-lock") || call.args[0] === "ci"), false);
  assert.equal(calls.some((call) => call.cmd === "git" && call.args[0] === "checkout"), false);
  fs.rmSync(w.root, { recursive: true, force: true });
});

test("a service install that rewrites package-lock.json restores it and leaves the live build running", async () => {
  const w = world();
  const git = gitState({
    lockfiles: { "dashboard/package-lock.json": " M dashboard/package-lock.json\n" },
  });
  const { run, calls } = runner(git, { onBuild: () => wroteRebuild(w.dashboard) });
  const status = await runRebuild(
    { mode: "service", checkout: w.checkout, stateDir: w.stateDir, pull: false },
    serviceDeps(run),
  );
  assert.equal(status.state, "failed");
  assert.match(status.error, /package-lock.json is out of sync with package.json; commit a regenerated lockfile/);
  assert.equal(fs.readFileSync(path.join(w.dashboard, ".next", "BUILD_ID"), "utf8"), "old\n");
  assert.deepEqual(
    calls.find((call) => call.cmd === "git" && call.args[0] === "checkout")?.args,
    ["checkout", "--", "dashboard/package-lock.json"],
  );
  assert.equal(calls.some((call) => call.cmd === "npm" && call.args[1] === "build"), false);
  assert.equal(calls.some((call) => call.cmd === "systemctl"), false);
  fs.rmSync(w.root, { recursive: true, force: true });
});

test("uncommitted work and a diverged branch are refused without git writes", async () => {
  const dirtyWorld = world();
  const dirtyGit = gitState({ dirty: " M dashboard/lib/x.ts\n" });
  const dirty = runner(dirtyGit);
  const dirtyStatus = await runRebuild(
    { mode: "service", checkout: dirtyWorld.checkout, stateDir: dirtyWorld.stateDir, pull: true },
    serviceDeps(dirty.run),
  );
  assert.equal(dirtyStatus.state, "failed");
  assert.match(dirtyStatus.error, /uncommitted/);
  assert.equal(dirty.calls.some((call) => call.cmd === "npm" || (call.cmd === "git" && call.args[0] === "pull")), false);

  const diverged = world();
  const divergedGit = gitState({ counts: "1\t1" });
  const div = runner(divergedGit);
  const divStatus = await runRebuild(
    { mode: "service", checkout: diverged.checkout, stateDir: diverged.stateDir, pull: true },
    serviceDeps(div.run),
  );
  assert.match(divStatus.error, /diverged/);
  assert.equal(div.calls.some((call) => call.cmd === "git" && call.args[0] === "pull"), false);
  fs.rmSync(dirtyWorld.root, { recursive: true, force: true });
  fs.rmSync(diverged.root, { recursive: true, force: true });
});

test("a live lock is a refusal and does not overwrite the running rebuild's status", async () => {
  const w = world();
  fs.mkdirSync(w.stateDir, { recursive: true });
  fs.writeFileSync(path.join(w.stateDir, "rebuild.lock"), JSON.stringify({ pid: 4242 }));
  fs.writeFileSync(path.join(w.stateDir, "rebuild-status.json"), "{\"state\":\"running\"}\n");
  const git = gitState();
  const { run, calls } = runner(git);
  const status = await runRebuild(
    { mode: "service", checkout: w.checkout, stateDir: w.stateDir, pull: false },
    serviceDeps(run, { alive: (pid) => pid === 4242, pid: 7 }),
  );
  assert.equal(status.state, "refused");
  assert.equal(fs.readFileSync(path.join(w.stateDir, "rebuild-status.json"), "utf8"), "{\"state\":\"running\"}\n");
  assert.equal(calls.length, 0);
  fs.rmSync(w.root, { recursive: true, force: true });
});

test("a payload rebuild records a local payload and does not build into the live .next", async () => {
  const w = world();
  const base = path.join(w.root, "base");
  fs.mkdirSync(path.join(base, "runtime"), { recursive: true });
  fs.writeFileSync(path.join(base, "runtime", "node"), "node");
  fs.mkdirSync(path.join(w.checkout, "desktop", "wsl"), { recursive: true });
  fs.writeFileSync(path.join(w.checkout, "desktop", "wsl", "devhub-wsl-launch.sh"), "#!/bin/sh\n");
  const git = gitState();
  const { run, calls } = runner(git, {
    onBuild: (opts) => {
      assert.equal(opts.env.DEVHUB_DIST_DIR, ".next-rebuild");
      const staging = path.join(w.checkout, "desktop", "staging");
      for (const name of ["server", "services", "resources"]) {
        fs.mkdirSync(path.join(staging, name), { recursive: true });
        fs.writeFileSync(path.join(staging, name, "marker"), name);
      }
    },
  });
  const status = await runRebuild(
    {
      mode: "payload",
      checkout: w.checkout,
      stateDir: w.stateDir,
      pull: false,
      appData: w.appData,
      basePayloadDir: base,
      basePayloadId: "pay",
    },
    serviceDeps(run, { smokePayload: async (partial) => {
      assert.equal(fs.existsSync(path.join(partial, ".complete")), false);
      assert.equal(fs.existsSync(path.join(w.appData, "config", "local-payload.json")), false);
      assert.equal(fs.existsSync(path.join(partial, "runtime", "node")), true);
    } }),
  );
  assert.equal(status.state, "succeeded");
  assert.equal(status.restartRequired, true);
  const record = JSON.parse(fs.readFileSync(path.join(w.appData, "config", "local-payload.json"), "utf8"));
  assert.equal(record.basePayloadId, "pay");
  assert.equal(record.commit, git.head);
  assert.equal(fs.existsSync(path.join(record.dir, ".complete")), true);
  assert.equal(fs.readFileSync(path.join(record.dir, "server", "marker"), "utf8"), "server");
  assert.equal(fs.readFileSync(path.join(w.dashboard, ".next", "BUILD_ID"), "utf8"), "old\n");
  assert.equal(calls.some((call) => call.cmd === "systemctl"), false);
  assert.deepEqual(
    calls.filter((call) => call.cmd === "npm" && call.args[0] === "ci").map((call) => call.args),
    [
      ["ci", "--include=dev", "--no-audit", "--no-fund"],
      ["ci", "--include=dev", "--no-audit", "--no-fund"],
    ],
  );
  assert.equal(calls.some((call) => call.cmd === "npm" && call.args[0] === "install"), false);
  assert.equal(calls.some((call) => call.args.includes("--no-package-lock")), false);
  fs.rmSync(w.root, { recursive: true, force: true });
});

test("a payload rebuild fails closed when the installed Node runtime is missing", async () => {
  const w = world();
  const git = gitState();
  const { run } = runner(git, {
    onBuild: () => {
      const staging = path.join(w.checkout, "desktop", "staging");
      for (const name of ["server", "services", "resources"]) {
        fs.mkdirSync(path.join(staging, name), { recursive: true });
      }
    },
  });
  fs.mkdirSync(path.join(w.checkout, "desktop", "wsl"), { recursive: true });
  fs.writeFileSync(path.join(w.checkout, "desktop", "wsl", "devhub-wsl-launch.sh"), "#!/bin/sh\n");
  const status = await runRebuild(
    {
      mode: "payload",
      checkout: w.checkout,
      stateDir: w.stateDir,
      pull: false,
      appData: w.appData,
      basePayloadDir: path.join(w.root, "missing-base"),
      basePayloadId: "pay",
    },
    serviceDeps(run),
  );
  assert.equal(status.state, "failed");
  assert.match(status.error, /Node runtime/);
  assert.equal(fs.existsSync(path.join(w.appData, "config", "local-payload.json")), false);
  fs.rmSync(w.root, { recursive: true, force: true });
});

const DIRTY = {
  NODE_ENV: "production",
  __NEXT_PRIVATE_STANDALONE_CONFIG: "x",
  NEXT_RUNTIME: "nodejs",
  npm_config_omit: "dev",
  NPM_CONFIG_PREFIX: "/bad",
  PORT: "1337",
  PATH: "/usr/bin",
  HOME: "/home/me",
};

test("install and build children do not inherit the running server's env", async () => {
  const w = world();
  const git = gitState();
  const { run, calls } = runner(git, { onBuild: () => wroteRebuild(w.dashboard) });
  const status = await runRebuild(
    { mode: "service", checkout: w.checkout, stateDir: w.stateDir, pull: false },
    serviceDeps(run, { env: DIRTY, execPath: "/opt/node22/bin/node" }),
  );
  assert.equal(status.state, "succeeded");
  for (const call of calls.filter((item) => item.cmd === "npm")) {
    assert.equal(call.env.NODE_ENV, undefined);
    assert.equal(call.env.__NEXT_PRIVATE_STANDALONE_CONFIG, undefined);
    assert.equal(call.env.NEXT_RUNTIME, undefined);
    assert.equal(call.env.npm_config_omit, undefined);
    assert.equal(call.env.NPM_CONFIG_PREFIX, undefined);
    assert.equal(call.env.PORT, undefined);
    assert.equal(call.env.HOME, "/home/me");
    assert.ok(call.env.PATH.startsWith("/opt/node22/bin"), call.env.PATH);
  }
  fs.rmSync(w.root, { recursive: true, force: true });
});

test("a failed service install restores the lockfile, puts devDependencies back, and does not restart", async () => {
  const w = world();
  const git = gitState();
  const { run, calls } = runner(git, { fail: { install: 1 } });
  const status = await runRebuild(
    { mode: "service", checkout: w.checkout, stateDir: w.stateDir, pull: false },
    serviceDeps(run),
  );
  assert.equal(status.state, "failed");
  assert.match(status.error, /npm install failed/);
  assert.equal(calls.some((call) => call.cmd === "systemctl"), false);
  assert.equal(calls.some((call) => call.cmd === "npm" && call.args[1] === "build"), false);
  assert.ok(calls.some((call) => call.cmd === "git" && call.args[0] === "checkout"));
  assert.ok(calls.some((call) => call.cmd === "npm" && call.args.includes("--ignore-scripts")));
  assert.equal(fs.readFileSync(path.join(w.dashboard, ".next", "BUILD_ID"), "utf8"), "old\n");
  fs.rmSync(w.root, { recursive: true, force: true });
});

test("a libc-only lockfile rewrite is in sync; a version change is not", async () => {
  const before = JSON.stringify({ name: "d", packages: { "": { version: "1.0.0", libc: ["glibc"] } } });
  const libcOnly = JSON.stringify({ name: "d", packages: { "": { version: "1.0.0" } } });
  const versionChanged = JSON.stringify({ name: "d", packages: { "": { version: "2.0.0", libc: ["glibc"] } } });
  assert.equal(lockfilesMatchIgnoringLibc(before, libcOnly), true);
  assert.equal(lockfilesMatchIgnoringLibc(before, versionChanged), false);
  assert.equal(shouldRestoreTsconfig(true, " M dashboard/tsconfig.json\n"), true);
  assert.equal(shouldRestoreTsconfig(false, " M dashboard/tsconfig.json\n"), false);
  assert.equal(shouldRestoreTsconfig(true, ""), false);

  const w = world();
  fs.writeFileSync(path.join(w.dashboard, "package-lock.json"), `${libcOnly}\n`);
  const git = gitState({
    lockfiles: { "dashboard/package-lock.json": " M dashboard/package-lock.json\n" },
    show: { "dashboard/package-lock.json": `${before}\n` },
  });
  const { run, calls } = runner(git, { onBuild: () => wroteRebuild(w.dashboard) });
  const status = await runRebuild(
    { mode: "service", checkout: w.checkout, stateDir: w.stateDir, pull: false },
    serviceDeps(run),
  );
  assert.equal(status.state, "succeeded", status.error);
  assert.ok(calls.some((call) => call.cmd === "git" && call.args[0] === "checkout"));
  assert.equal(calls.some((call) => call.cmd === "systemctl"), true);
  fs.rmSync(w.root, { recursive: true, force: true });
});

test("a resolved change in the lockfile still stops the rebuild", async () => {
  const before = JSON.stringify({ packages: { "node_modules/leftpad": { version: "1.0.0", resolved: "https://example/a.tgz", integrity: "sha512-aaa" } } });
  const after = JSON.stringify({ packages: { "node_modules/leftpad": { version: "1.0.0", resolved: "https://example/b.tgz", integrity: "sha512-bbb" } } });
  assert.equal(lockfilesMatchIgnoringLibc(before, after), false);
  const w = world();
  fs.writeFileSync(path.join(w.dashboard, "package-lock.json"), after);
  const git = gitState({
    lockfiles: { "dashboard/package-lock.json": " M dashboard/package-lock.json\n" },
    show: { "dashboard/package-lock.json": before },
  });
  const { run, calls } = runner(git);
  const status = await runRebuild(
    { mode: "service", checkout: w.checkout, stateDir: w.stateDir, pull: false },
    serviceDeps(run),
  );
  assert.equal(status.state, "failed");
  assert.match(status.error, /out of sync/);
  assert.equal(calls.some((call) => call.cmd === "systemctl"), false);
  fs.rmSync(w.root, { recursive: true, force: true });
});

test("a build that rewrites tsconfig.json is restored when the file was clean", async () => {
  const w = world();
  const git = gitState();
  const { run, calls } = runner(git, {
    onBuild: () => {
      wroteRebuild(w.dashboard);
      git.tsconfigDirty = " M dashboard/tsconfig.json\n";
    },
  });
  const status = await runRebuild(
    { mode: "service", checkout: w.checkout, stateDir: w.stateDir, pull: false },
    serviceDeps(run),
  );
  assert.equal(status.state, "succeeded", status.error);
  assert.ok(calls.some((call) => call.args[2] === "dashboard/tsconfig.json"));
  fs.rmSync(w.root, { recursive: true, force: true });
});

test("assertNpm10 accepts the npm next to this node and rejects another major", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-npm-"));
  const prefix = path.join(root, "node");
  const cli = path.join(prefix, "lib", "node_modules", "npm", "bin", "npm-cli.js");
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.writeFileSync(cli, "");
  const execPath = path.join(prefix, "bin", "node");
  const ok = await assertNpm10(execPath, async () => ({ code: 0, stdout: "10.9.8\n", stderr: "" }));
  assert.deepEqual(ok, { cmd: execPath, prefix: [cli] });
  await assert.rejects(
    () => assertNpm10(execPath, async () => ({ code: 0, stdout: "11.6.0\n", stderr: "" })),
    /npm 10/,
  );
  await assert.rejects(
    () => assertNpm10(path.join(root, "other", "bin", "node"), async () => ({ code: 0, stdout: "10.9.8\n", stderr: "" })),
    /not found next to node/,
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test("a stale lock whose pid is dead is replaced", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-rebuild-dead-lock-"));
  const file = path.join(dir, "rebuild.lock");
  fs.writeFileSync(file, JSON.stringify({ pid: 4242, startedAt: "then" }));
  const held = acquireLock(file, { alive: () => true, pid: 7, now: () => "now" });
  assert.equal(held.ok, false);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).pid, 4242);
  const replaced = acquireLock(file, { alive: () => false, pid: 7, now: () => "now" });
  assert.equal(replaced.ok, true);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).pid, 7);
  replaced.release();
  assert.equal(fs.existsSync(file), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
