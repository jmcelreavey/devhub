import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runRebuild } from "./checkout-rebuild.mjs";

const FORBIDDEN_GIT = new Set(["reset", "stash", "clean", "rebase"]);

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
      assert.match(String(args[2]), /package-lock\.json$/);
      git.restored = args[2];
      return { code: 0, stdout: "", stderr: "" };
    }
    if (cmd === "git" && args[0] === "status") {
      const spec = args.indexOf("--");
      if (spec !== -1) {
        return { code: 0, stdout: git.lockfiles?.[args[spec + 1]] ?? "", stderr: "" };
      }
      return { code: 0, stdout: git.dirty, stderr: "" };
    }
    if (cmd === "git" && args[0] === "rev-list") return { code: git.countCode, stdout: `${git.counts}\n`, stderr: "" };
    if (cmd === "git" && args[0] === "fetch") return { code: fail.fetch ?? 0, stdout: "", stderr: "" };
    if (cmd === "git" && args[0] === "pull") {
      assert.deepEqual(args, ["pull", "--ff-only"]);
      if (fail.pull) return { code: fail.pull, stdout: "", stderr: "" };
      git.counts = "0\t0";
      git.head = "pulledcommit12abcdef";
      return { code: 0, stdout: "", stderr: "" };
    }
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
    [["install", "--no-audit", "--no-fund"]],
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
    serviceDeps(run),
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
      ["ci", "--no-audit", "--no-fund"],
      ["ci", "--no-audit", "--no-fund"],
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
