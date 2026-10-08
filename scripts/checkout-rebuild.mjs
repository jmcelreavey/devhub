#!/usr/bin/env node
/**
 * Rebuild DevHub from the user's own checkout, on Linux and in WSL.
 *
 * The Mac app has View → Rebuild Dashboard; the Windows app runs its server in
 * WSL2, where that menu item (a native `npm` on the wrong machine) can't work.
 * This is the Linux-side equivalent, run by the dashboard in two situations:
 *
 *   mode "service"  the always-on `devhub.service` that runs from a checkout
 *                   (WorkingDirectory=<repo> or <repo>/dashboard). Pull, build
 *                   into a separate dist dir, swap it in, restart the unit,
 *                   check it answers. A failed build never touches the running
 *                   one; a failed restart or health check swaps the old build back.
 *   mode "payload"  the packaged Windows app with a linked checkout. Pull, stage
 *                   the dashboard from the checkout, and assemble a new
 *                   payload under <app-data>/runtime/local-<commit>. The shell
 *                   picks it on the next start (the page offers the restart).
 *
 * Rules that hold in both modes:
 *   - never stash, reset, or check out the user's work: a dirty or diverged
 *     checkout is refused. The only checkouts are restoring a package-lock.json
 *     or tsconfig.json that the build rewrote after the tree was verified clean;
 *   - one rebuild at a time (a lock file whose owner must still be alive);
 *   - progress is a status file the UI polls, output is a log it can show.
 *
 * All side effects go through `deps` so the phases, the failure handling and
 * the lock are unit-tested without a git repo, npm or systemd.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { smokePayload } from "./checkout-payload-smoke.mjs";
import {
  cleanBuildEnv,
  lockfilesMatchIgnoringLibc,
  resolveNpmCli,
  shouldRestoreTsconfig,
  withNodeToolchain,
} from "../dashboard/lib/desktop/build-env.mjs";

export const NPM_MAJOR = 10;

export const PHASE_LABELS = {
  preflight: "Check the checkout",
  pull: "Pull new commits",
  install: "Install dependencies",
  build: "Build",
  switch: "Switch to the new build",
  restart: "Restart devhub.service",
  verify: "Check it came back",
  assemble: "Assemble the new app payload",
};

export const MODE_PHASES = {
  service: ["preflight", "pull", "install", "build", "switch", "restart", "verify"],
  payload: ["preflight", "pull", "install", "build", "assemble"],
};

export const UNIT = "devhub.service";
export const REBUILD_DIST = ".next-rebuild";
export const PREVIOUS_DIST = ".next-previous";
export const REBUILD_CODE = ["scripts/checkout-rebuild.mjs", "scripts/checkout-payload-smoke.mjs", "dashboard/lib/desktop/build-env.mjs"];

export class RebuildError extends Error {
  constructor(message, { rolledBack = false } = {}) {
    super(message);
    this.name = "RebuildError";
    this.rolledBack = rolledBack;
  }
}

export function initialStatus(mode, now, launcher = "direct") {
  return {
    state: "running",
    mode,
    launcher,
    phase: null,
    phases: MODE_PHASES[mode].map((id) => ({ id, label: PHASE_LABELS[id], state: "pending" })),
    startedAt: now,
    finishedAt: null,
    error: null,
    rolledBack: false,
    restartRequired: false,
    commit: null,
  };
}

/** Whether a process with this pid is alive (signal 0 probes without signalling). */
export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

/**
 * Take the rebuild lock, or say who has it. A lock whose owner is gone (a crash,
 * a reboot) is stale and replaced, so one bad run can never block rebuilds forever.
 */
export function acquireLock(lockFile, { fs: fsx = fs, alive = pidAlive, pid = process.pid, now = () => new Date().toISOString() } = {}) {
  fsx.mkdirSync(path.dirname(lockFile), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fsx.openSync(lockFile, "wx");
      fsx.writeSync(fd, JSON.stringify({ pid, startedAt: now() }));
      fsx.closeSync(fd);
      let released = false;
      return {
        ok: true,
        release: () => {
          if (released) return;
          released = true;
          fsx.rmSync(lockFile, { force: true });
        },
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let owner = null;
      try {
        owner = JSON.parse(fsx.readFileSync(lockFile, "utf8"));
      } catch {
        // unreadable: treat as stale
      }
      if (owner && Number.isInteger(owner.pid) && alive(owner.pid)) {
        return { ok: false, owner };
      }
      fsx.rmSync(lockFile, { force: true });
    }
  }
  return { ok: false, owner: null };
}

/** What git says about the checkout, from the same few commands the preflight uses. */
export async function inspectCheckout(git, checkout, fsx = fs) {
  const branch = (await git(["branch", "--show-current"])).stdout.trim();
  const head = (await git(["rev-parse", "HEAD"])).stdout.trim();
  const status = await git(["status", "--porcelain", "--untracked-files=no"]);
  const dirty = status.stdout.split("\n").map((line) => line.trimEnd()).filter(Boolean);
  const gitDir = path.join(checkout, ".git");
  const inProgress = ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"].some((name) => fsx.existsSync(path.join(gitDir, name)));
  const counts = await git(["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]);
  let ahead = 0;
  let behind = 0;
  const hasUpstream = counts.code === 0;
  if (hasUpstream) {
    const [b, a] = counts.stdout.trim().split(/\s+/).map((n) => Number.parseInt(n, 10) || 0);
    behind = b;
    ahead = a;
  }
  return { branch, head, dirty, inProgress, hasUpstream, ahead, behind };
}

/** Why a rebuild must not start, or null. The user's uncommitted work is never touched. */
export function refusalReason(state, { pull }) {
  if (state.inProgress) return "A merge, rebase or cherry-pick is in progress. Finish or abort it first.";
  if (state.dirty.length > 0) {
    const shown = state.dirty.slice(0, 5).join("\n  ");
    return `You have uncommitted changes in the checkout (${state.dirty.length}). Commit or stash them first; DevHub will not touch them.\n  ${shown}`;
  }
  if (!state.branch) return "The checkout is on a detached HEAD. Check out a branch first.";
  if (pull && state.hasUpstream && state.ahead > 0 && state.behind > 0) {
    return `The branch has diverged from its upstream (${state.ahead} ahead, ${state.behind} behind). Rebase or merge it yourself first.`;
  }
  return null;
}

function sha256(file, fsx) {
  try {
    return crypto.createHash("sha256").update(fsx.readFileSync(file)).digest("hex");
  } catch {
    return null;
  }
}

function readJson(file, fsx) {
  try {
    return JSON.parse(fsx.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function buildEnv(extra) {
  return { DEVHUB_VERIFY_BUILD: "", ...extra };
}

/**
 * npm from the Node that is running this script. A login shell's nvm default
 * is a different toolchain (often npm 11) and must not be consulted.
 */
export async function assertNpm10(execPath, run, existsSync = fs.existsSync, env = process.env) {
  const cli = resolveNpmCli(execPath, existsSync);
  if (!cli) {
    throw new RebuildError(
      `npm was not found next to node (${execPath}). DevHub's rebuild runs the npm that ships with that Node, not whatever \`npm\` is first on PATH.`,
    );
  }
  const result = await run(execPath, [cli, "--version"], { env: cleanBuildEnv(env) });
  const raw = `${result.stdout ?? ""}`.trim();
  const major = Number(raw.split(".")[0]);
  if (result.code !== 0 || major !== NPM_MAJOR) {
    throw new RebuildError(
      `DevHub's rebuild needs npm ${NPM_MAJOR} (the Node at ${execPath} reported ${raw || "unknown"}). Install Node 22, which ships npm 10.`,
    );
  }
  return { cmd: execPath, prefix: [cli] };
}

/**
 * Run a rebuild. Resolves with the final status; never throws for an expected
 * failure (the status carries it), so the caller always has something to show.
 */
export async function runRebuild(options, deps) {
  const { mode, checkout, stateDir } = options;
  const { fs: fsx = fs, run: runRaw, now = () => new Date().toISOString(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = deps;
  const execPath = deps.execPath ?? process.execPath;
  let handedOver = false;
  const baseEnv = withNodeToolchain(cleanBuildEnv(deps.env ?? process.env), execPath);
  if (!MODE_PHASES[mode]) throw new Error(`Unknown rebuild mode: ${mode}`);

  const statusFile = path.join(stateDir, "rebuild-status.json");
  const lockFile = path.join(stateDir, "rebuild.lock");
  const logFile = path.join(stateDir, "rebuild.log");
  fsx.mkdirSync(stateDir, { recursive: true });

  const lock = acquireLock(lockFile, {
    fs: fsx,
    alive: deps.alive ?? pidAlive,
    pid: deps.pid ?? process.pid,
    now,
  });
  if (!lock.ok) {
    // Deliberately does not touch the status file: it describes the run that owns the lock.
    return { state: "refused", error: "A rebuild is already running.", owner: lock.owner };
  }

  const status = initialStatus(mode, now(), options.launcher ?? "direct");
  const log = (line) => fsx.appendFileSync(logFile, `${line}\n`);
  const run = (cmd, args, opts = {}) => runRaw(cmd, args, { ...opts, env: { ...baseEnv, ...(opts.env ?? {}) }, log: opts.log ?? log });
  const save = () => fsx.writeFileSync(statusFile, `${JSON.stringify(status, null, 2)}\n`);
  if (options.afterPull) {
    // The parent script already logged its pull output and the hand-over line to this
    // file; truncating it here would lose the evidence that the hand-over happened.
    log(`[${now()}] rebuild continued by the checkout script (${mode}, ${status.launcher}) in ${checkout}`);
  } else {
    fsx.writeFileSync(logFile, `[${now()}] rebuild started (${mode}, ${status.launcher}) in ${checkout}\n`);
  }
  save();

  const phase = (id) => status.phases.find((p) => p.id === id);
  const git = (args) => run("git", args, { cwd: checkout, log });
  const step = async (id, work) => {
    const entry = phase(id);
    status.phase = id;
    entry.state = "running";
    save();
    log(`--- ${entry.label}`);
    try {
      const outcome = await work();
      entry.state = outcome === "skipped" ? "skipped" : "done";
      save();
    } catch (error) {
      entry.state = "failed";
      throw error;
    }
  };
  const mustRun = async (cmd, args, opts, what) => {
    const result = await run(cmd, args, { ...opts, log });
    if (result.code !== 0) throw new RebuildError(`${what} failed (exit ${result.code}). See the log for the output.`);
    return result;
  };

  try {
    if (mode === "payload" && !options.appData) {
      throw new RebuildError("The app data directory was not passed, so a new payload cannot be assembled.");
    }
    let state;
    await step("preflight", async () => {
      state = await inspectCheckout(git, checkout, fsx);
      const refusal = refusalReason(state, { pull: options.pull });
      if (refusal) throw new RebuildError(refusal);
    });

    await step("pull", async () => {
      if (options.afterPull) return;
      if (!options.pull) return "skipped";
      await mustRun("git", ["fetch", "--quiet"], { cwd: checkout }, "git fetch");
      state = await inspectCheckout(git, checkout, fsx);
      const refusal = refusalReason(state, { pull: true });
      if (refusal) throw new RebuildError(refusal);
      if (!state.hasUpstream || state.behind === 0) return "skipped";
      // --ff-only: a fast-forward cannot overwrite anything of the user's.
      const oldHead = state.head;
      await mustRun("git", ["pull", "--ff-only"], { cwd: checkout }, "git pull");
      state = await inspectCheckout(git, checkout, fsx);
      if (oldHead !== state.head) {
        const changed = await mustRun("git", ["diff", "--name-only", oldHead, state.head, "--", ...REBUILD_CODE], { cwd: checkout }, "Checking updated rebuild code");
        if (changed.stdout.trim()) status.afterPull = oldHead;
      }
    });
    status.commit = state.head;
    // Launched from the installed bundle's copy (payload pulls): once the pull
    // is done, the checkout's own script is the one that matches its code.
    const checkoutScript = path.join(checkout, "scripts", "checkout-rebuild.mjs");
    if (options.pull && !status.afterPull && deps.selfPath
      && path.resolve(deps.selfPath) !== path.resolve(checkoutScript) && fsx.existsSync(checkoutScript)) {
      status.afterPull = state.head;
    }
    if (status.afterPull) {
      const args = deps.argv ?? rebuildArgs(options);
      log("Handing over to the checkout's own rebuild script after the pull.");
      lock.release();
      handedOver = true;
      const result = await run(execPath, [path.join(checkout, "scripts", "checkout-rebuild.mjs"), ...afterPullArgs(args, status.afterPull)], { cwd: checkout });
      const remainingLock = readJson(lockFile, fsx);
      if (remainingLock && Number.isInteger(remainingLock.pid)) {
        if ((deps.alive ?? pidAlive)(remainingLock.pid)) {
          return { state: "refused", error: "Another rebuild owns the lock after hand-over.", exitCode: result.code || 1 };
        }
        fsx.rmSync(lockFile, { force: true });
      }
      const childStatus = readJson(statusFile, fsx);
      if (childStatus && ["succeeded", "failed", "refused"].includes(childStatus.state)) {
        return { ...childStatus, exitCode: result.code };
      }
      handedOver = false;
      throw new RebuildError("The updated rebuild script exited without a final status (exit " + result.code + "). See the log.");
    }

    const dashboard = path.join(checkout, "dashboard");
    const lockDirs = mode === "payload" ? [dashboard, path.join(checkout, "desktop")] : [dashboard];
    const lockHash = lockDirs.map((dir) => sha256(path.join(dir, "package-lock.json"), fsx) ?? "none").join(":");
    const buildRecordFile = mode === "service" ? path.join(dashboard, ".next", "devhub-build.json") : path.join(options.appData ?? "", "config", "local-payload.json");
    const previousBuild = readJson(buildRecordFile, fsx);
    let npmInvoke = deps.npmInvoke ?? null;
    const npm = async () => {
      if (!npmInvoke) npmInvoke = await assertNpm10(execPath, run, deps.npmExists ?? fs.existsSync, baseEnv);
      return npmInvoke;
    };
    const restoreTsconfig = async () => {
      const rel = "dashboard/tsconfig.json";
      const wasClean = !state.dirty.some((line) => line.includes("tsconfig.json"));
      const after = await git(["status", "--porcelain", "--", rel]);
      if (after.code !== 0) throw new RebuildError("Could not check whether tsconfig.json changed.");
      if (!shouldRestoreTsconfig(wasClean, after.stdout ?? "")) return;
      await mustRun("git", ["checkout", "--", rel], { cwd: checkout }, "Restoring tsconfig.json");
      log("Restored dashboard/tsconfig.json (the build had added a dist-dir include).");
    };

    await step("install", async () => {
      const installed = lockDirs.every((dir) => fsx.existsSync(path.join(dir, "node_modules")));
      // Installing rewrites node_modules under whatever is running from it, so it
      // only happens when the lockfiles changed or the modules are missing.
      if (installed && previousBuild?.lockHash === lockHash) return "skipped";
      const invocation = await npm();
      for (const dir of lockDirs) {
        // ci for a payload: nothing is running from these modules, and ci
        // installs the lockfile exactly. install for the service: ci would
        // delete the node_modules the live unit is using. install still
        // honours the lockfile; --no-package-lock would not.
        // --include=dev: a leaked NODE_ENV=production must not prune tsx.
        const npmArgs = mode === "payload"
          ? ["ci", "--include=dev", "--no-audit", "--no-fund"]
          : ["install", "--include=dev", "--no-audit", "--no-fund"];
        const what = mode === "payload" ? "npm ci" : "npm install";
        const result = await run(invocation.cmd, [...invocation.prefix, ...npmArgs], { cwd: dir, log });
        if (result.code !== 0) {
          const lockRel = path.relative(checkout, path.join(dir, "package-lock.json"));
          const restored = await run("git", ["checkout", "--", lockRel], { cwd: checkout, log });
          if (restored.code !== 0) log(`Could not restore ${lockRel} (exit ${restored.code}).`);
          if (mode === "service") {
            log(restored.code === 0
              ? "Install failed. Restored package-lock.json and putting devDependencies back. The service was not restarted."
              : "Install failed. The service was not restarted.");
            const recover = await run(invocation.cmd, [...invocation.prefix, "install", "--include=dev", "--no-audit", "--no-fund", "--ignore-scripts"], { cwd: dir, log });
            // The recovery install can rewrite the lockfile we just restored.
            const relock = await run("git", ["checkout", "--", lockRel], { cwd: checkout, log });
            if (relock.code !== 0) log(`Could not restore ${lockRel} after putting devDependencies back.`);
            if (recover.code !== 0) log("Could not restore node_modules after the failed install.");
          }
          throw new RebuildError(`${what} failed (exit ${result.code}). See the log for the output.`);
        }
        if (mode !== "service") continue;
        const lockRel = path.relative(checkout, path.join(dir, "package-lock.json"));
        const after = await git(["status", "--porcelain", "--", lockRel]);
        if (after.code !== 0) throw new RebuildError("Could not check whether package-lock.json changed.");
        if (!after.stdout.trim()) continue;
        const headCopy = await git(["show", `HEAD:${lockRel}`]);
        let working = "";
        try { working = fsx.readFileSync(path.join(dir, "package-lock.json"), "utf8"); } catch { working = ""; }
        const libcOnly = headCopy.code === 0 && lockfilesMatchIgnoringLibc(headCopy.stdout ?? "", working);
        await mustRun("git", ["checkout", "--", lockRel], { cwd: checkout }, "Restoring package-lock.json");
        if (libcOnly) {
          log(`${lockRel} only differed by npm libc metadata; restored the committed lockfile.`);
          continue;
        }
        throw new RebuildError("package-lock.json is out of sync with package.json; commit a regenerated lockfile");
      }
    });

    if (mode === "service") {
      const rebuildDist = path.join(dashboard, REBUILD_DIST);
      const liveDist = path.join(dashboard, ".next");
      const previousDist = path.join(dashboard, PREVIOUS_DIST);
      fsx.rmSync(rebuildDist, { recursive: true, force: true });

      try {
        await step("build", async () => {
          try {
            const invocation = await npm();
            await mustRun(invocation.cmd, [...invocation.prefix, "run", "build"], { cwd: dashboard, env: buildEnv({ DEVHUB_DIST_DIR: REBUILD_DIST }) }, "The build");
            if (!fsx.existsSync(path.join(rebuildDist, "BUILD_ID"))) throw new RebuildError("The build finished but produced no output.");
            fsx.writeFileSync(path.join(rebuildDist, "devhub-build.json"), `${JSON.stringify({ commit: state.head, lockHash, builtAt: now() })}\n`);
          } finally {
            await restoreTsconfig();
          }
        });
      } catch (error) {
        // The running build was never touched.
        fsx.rmSync(rebuildDist, { recursive: true, force: true });
        throw error;
      }

      const swapBack = () => {
        fsx.rmSync(liveDist, { recursive: true, force: true });
        if (fsx.existsSync(previousDist)) fsx.renameSync(previousDist, liveDist);
      };
      await step("switch", async () => {
        fsx.rmSync(previousDist, { recursive: true, force: true });
        if (fsx.existsSync(liveDist)) fsx.renameSync(liveDist, previousDist);
        fsx.renameSync(rebuildDist, liveDist);
      });

      const restart = async () => {
        const result = await run("systemctl", ["--user", "restart", UNIT], { cwd: checkout, log });
        if (result.code !== 0) throw new RebuildError(`systemctl restart ${UNIT} failed (exit ${result.code}).`);
      };
      const healthy = async () => {
        const deadline = Date.now() + (options.healthTimeoutMs ?? 90_000);
        while (Date.now() < deadline) {
          if (await deps.healthy()) return true;
          await sleep(1000);
        }
        return false;
      };
      try {
        await step("restart", restart);
        await step("verify", async () => {
          if (!(await healthy())) throw new RebuildError(`${UNIT} did not answer after the restart.`);
        });
      } catch (error) {
        log(`!!! ${error.message} Restoring the previous build.`);
        swapBack();
        status.rolledBack = true;
        try {
          await restart();
          const back = await healthy();
          log(back ? "Previous build restored and answering." : "Previous build restored but not answering yet; check `systemctl --user status devhub.service`.");
        } catch (restoreError) {
          log(`Could not restart after restoring: ${restoreError.message}`);
        }
        throw new RebuildError(`${error.message} The previous build was restored.`, { rolledBack: true });
      }
    } else {
      await step("build", async () => {
        try {
          await mustRun(process.execPath, [path.join(checkout, "desktop", "scripts", "stage-resources.mjs")], { cwd: checkout }, "Staging resources");
          // .next-rebuild, not .next: a devhub.service on this checkout is running
          // from .next, and the stage script deletes the dist dir it builds into.
          await mustRun(process.execPath, [path.join(checkout, "desktop", "scripts", "stage-dashboard.mjs")], { cwd: checkout, env: buildEnv({ DEVHUB_DIST_DIR: REBUILD_DIST }) }, "The build");
        } finally {
          await restoreTsconfig();
        }
      });
      await step("assemble", async () => {
        const base = options.basePayloadDir;
        if (!base || !fsx.existsSync(path.join(base, "runtime", "node"))) {
          throw new RebuildError("The installed app payload (its Node runtime) was not found, so a new one can't be assembled.");
        }
        const staging = path.join(checkout, "desktop", "staging");
        const target = path.join(options.appData, "runtime", `local-${state.head.slice(0, 12)}`);
        const partial = `${target}.partial`;
        fsx.rmSync(partial, { recursive: true, force: true });
        fsx.mkdirSync(partial, { recursive: true });
        const copy = (from, to) => fsx.cpSync(from, path.join(partial, to), { recursive: true, dereference: true, force: true });
        copy(path.join(base, "runtime"), "runtime");
        copy(path.join(staging, "server"), "server");
        copy(path.join(staging, "services"), "services");
        copy(path.join(staging, "resources"), "resources");
        const launcher = path.join(partial, "bin", "devhub-wsl-launch");
        fsx.mkdirSync(path.dirname(launcher), { recursive: true });
        fsx.copyFileSync(path.join(checkout, "desktop", "wsl", "devhub-wsl-launch.sh"), launcher);
        fsx.chmodSync(launcher, 0o755);
        try {
          await (deps.smokePayload ?? smokePayload)(partial, { env: baseEnv, log });
        } catch (error) {
          fsx.rmSync(partial, { recursive: true, force: true });
          throw error;
        }
        fsx.writeFileSync(path.join(partial, ".complete"), "");
        fsx.rmSync(target, { recursive: true, force: true });
        fsx.renameSync(partial, target);
        // Recorded last: until this exists the shell keeps using the installed payload.
        fsx.mkdirSync(path.dirname(buildRecordFile), { recursive: true });
        fsx.writeFileSync(buildRecordFile, `${JSON.stringify({ dir: target, commit: state.head, lockHash, basePayloadId: options.basePayloadId ?? null, builtAt: now() }, null, 2)}\n`);
        // Older local builds, except the one running right now.
        const runtime = path.join(options.appData, "runtime");
        for (const name of fsx.readdirSync(runtime)) {
          const dir = path.join(runtime, name);
          if (name.startsWith("local-") && dir !== target && dir !== base) fsx.rmSync(dir, { recursive: true, force: true });
        }
        status.restartRequired = true;
      });
    }

    status.state = "succeeded";
    status.phase = null;
    log(`[${now()}] rebuild finished`);
  } catch (error) {
    handedOver = handedOver && fsx.existsSync(lockFile);
    status.state = "failed";
    status.error = error instanceof Error ? error.message : String(error);
    if (error instanceof RebuildError && error.rolledBack) status.rolledBack = true;
    log(`[${now()}] rebuild failed: ${status.error}`);
  } finally {
    if (!handedOver) {
      status.finishedAt = now();
      save();
    }
    lock.release();
  }
  return status;
}

/** Real subprocess runner: output goes to the log line by line. */
export function spawnRun(cmd, args, { cwd, env, log } = {}) {
  return new Promise((resolve) => {
    const childEnv = withNodeToolchain(cleanBuildEnv({ ...process.env, ...(env ?? {}) }), process.execPath);
    const child = spawn(cmd, args, { cwd, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const pump = (chunk, sink) => {
      const text = chunk.toString();
      if (sink === "out") stdout += text;
      else stderr += text;
      for (const line of text.split("\n")) if (line.trim()) log?.(line);
    };
    log?.(`$ ${cmd} ${args.join(" ")}`);
    child.stdout.on("data", (chunk) => pump(chunk, "out"));
    child.stderr.on("data", (chunk) => pump(chunk, "err"));
    child.on("error", (error) => {
      log?.(`could not start ${cmd}: ${error.message}`);
      resolve({ code: 127, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function healthy(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const out = { pull: false };
  for (const arg of argv) {
    if (arg === "--pull") out.pull = true;
    else if (arg.startsWith("--") && arg.includes("=")) {
      const [key, ...rest] = arg.slice(2).split("=");
      out[key] = rest.join("=");
    }
  }
  return out;
}

export function optionsFromArgs(argv) {
  const args = parseArgs(argv);
  return {
    mode: args.mode,
    checkout: args.checkout,
    stateDir: args.state,
    appData: args["app-data"],
    basePayloadDir: args["base-payload"],
    basePayloadId: args["base-payload-id"],
    pull: args.pull && !args["after-pull"],
    afterPull: args["after-pull"],
    launcher: args.launcher,
    port: args.port ?? "1337",
  };
}

function rebuildArgs(options) {
  const mapping = { mode: "mode", checkout: "checkout", state: "stateDir", "app-data": "appData", "base-payload": "basePayloadDir", "base-payload-id": "basePayloadId", launcher: "launcher", port: "port" };
  return Object.entries(mapping).filter(([, key]) => options[key] !== undefined).map(([flag, key]) => "--" + flag + "=" + options[key]);
}

export function afterPullArgs(argv, oldHead) {
  return [...argv.filter((arg) => arg !== "--pull" && !arg.startsWith("--after-pull=")), "--after-pull=" + oldHead];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  const options = optionsFromArgs(argv);
  if (!options.mode || !options.checkout || !options.stateDir) {
    process.stderr.write("usage: checkout-rebuild.mjs --mode=service|payload --checkout=DIR --state=DIR [--pull] [--app-data=DIR --base-payload=DIR] [--port=N]\n");
    process.exit(2);
  }
  const result = await runRebuild(options, { argv, selfPath: fileURLToPath(import.meta.url), run: spawnRun, healthy: () => healthy("http://127.0.0.1:" + options.port + "/api/status/dashboard/rebuild") });
  process.exit(result.exitCode ?? (result.state === "succeeded" ? 0 : 1));
}
