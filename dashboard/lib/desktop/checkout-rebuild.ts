import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { execExternal } from "@/lib/exec-external";
import { readBundleSource } from "@/lib/desktop/bundle-source";
import { cleanBuildEnv, withNodeToolchain } from "@/lib/desktop/build-env.mjs";
import { getAppDataDir, getCheckoutRoot } from "@/lib/desktop/runtime-paths";
import { payloadRestartStatus } from "@/lib/desktop/payload-restart";

export type RebuildMode = "service" | "payload";

export interface RebuildPhase {
  id: string;
  label: string;
  state: string;
}

export interface RebuildStatus {
  state: "running" | "succeeded" | "failed" | "refused" | "interrupted";
  mode?: string;
  launcher?: string;
  phase: string | null;
  phases: RebuildPhase[];
  error: string | null;
  rolledBack: boolean;
  restartRequired: boolean;
  commit: string | null;
  startedAt?: string;
  finishedAt?: string | null;
}

export interface RebuildFacts {
  platform: NodeJS.Platform;
  desktop: boolean;
  wsl: boolean;
  systemd: boolean;
  checkout: string | null;
  hasDashboard: boolean;
  hasScript: boolean;
  runningCommit: string | null;
  headCommit: string | null;
  runningIsAncestor: boolean;
  /** False when the recorded commit is not in this checkout (a public release SHA). */
  runningKnown?: boolean;
  headCommitMs?: number | null;
  bundleBuiltAtMs?: number | null;
  appData: string;
  basePayloadDir: string | null;
  basePayloadId: string | null;
  stateDir: string;
  port: string;
}

export interface RebuildOffer {
  available: boolean;
  mode: RebuildMode | null;
  checkout: string | null;
  checkoutAhead: boolean;
  reason?: string;
  stateDir: string;
  appData: string;
  basePayloadDir: string | null;
  basePayloadId: string | null;
  port: string;
  status: RebuildStatus | null;
  log: string;
}

export type OfferDecision = Omit<RebuildOffer, "status" | "log">;

export interface AheadInput {
  running: string | null;
  head: string | null;
  runningIsAncestor: boolean;
  /** The recorded commit exists in this checkout. A public release SHA does not. */
  runningKnown: boolean;
  headCommitMs: number | null;
  bundleBuiltAtMs: number | null;
}

/**
 * Whether Check for Updates should offer a checkout rebuild.
 *
 * A commit this repo contains is ahead only when it is an ancestor of HEAD.
 * A release build's public SHA is not in the private checkout, so that test
 * can never succeed. Then HEAD is ahead only when its commit time is strictly
 * later than the bundle was built — equal or older is behind or the same generation.
 */
export function decideCheckoutAhead(input: AheadInput): boolean {
  if (!input.head) return false;
  if (input.running && input.running === input.head) return false;
  if (input.runningKnown) return Boolean(input.running && input.runningIsAncestor);
  if (input.headCommitMs == null || input.bundleBuiltAtMs == null) return false;
  return input.headCommitMs > input.bundleBuiltAtMs;
}

export function checkoutIsAhead(running: string | null, head: string | null, runningIsAncestor: boolean): boolean {
  return decideCheckoutAhead({
    running,
    head,
    runningIsAncestor,
    runningKnown: true,
    headCommitMs: null,
    bundleBuiltAtMs: null,
  });
}

/**
 * Where a rebuild is allowed to run.
 *
 * The Windows app's server is Linux inside WSL (`DEVHUB_DESKTOP` plus a WSL
 * env). `devhub.service` is a systemd unit started from the checkout. macOS
 * keeps View → Rebuild Dashboard, which runs npm on the Mac.
 */
export function classifyRebuild(facts: RebuildFacts): OfferDecision {
  const base: OfferDecision = {
    available: false,
    mode: null,
    checkout: facts.checkout,
    checkoutAhead: false,
    stateDir: facts.stateDir,
    appData: facts.appData,
    basePayloadDir: facts.basePayloadDir,
    basePayloadId: facts.basePayloadId,
    port: facts.port,
  };
  if (facts.platform === "darwin") {
    return { ...base, reason: "On macOS, use View → Rebuild Dashboard…." };
  }
  if (facts.platform === "win32") {
    return { ...base, reason: "Rebuild runs inside WSL, where the Windows app's server lives." };
  }
  if (!facts.checkout || !facts.hasDashboard) {
    return {
      ...base,
      reason: facts.checkout
        ? "The linked folder is not a DevHub checkout (no dashboard/package.json)."
        : "No DevHub checkout is linked. Link the private repo first.",
    };
  }

  let mode: RebuildMode | null = null;
  if (facts.desktop && facts.wsl) mode = "payload";
  else if (!facts.desktop && facts.systemd) mode = "service";
  else if (facts.desktop) {
    return { ...base, reason: "This desktop server is not the Windows app running in WSL." };
  } else {
    return {
      ...base,
      reason: "Rebuild from checkout runs in the Windows app, or under devhub.service. A checkout dev server uses Rebuild & restart.",
    };
  }

  if (!facts.hasScript) {
    return { ...base, mode, reason: "This checkout has no scripts/checkout-rebuild.mjs. Update it first." };
  }
  if (mode === "payload" && (!facts.basePayloadDir || !facts.basePayloadId)) {
    return {
      ...base,
      mode,
      reason: "The app did not say where its installed payload is. Quit and reopen DevHub, then try again.",
    };
  }
  return {
    ...base,
    available: true,
    mode,
    checkoutAhead: decideCheckoutAhead({
      running: facts.runningCommit,
      head: facts.headCommit,
      runningIsAncestor: facts.runningIsAncestor,
      runningKnown: facts.runningKnown !== false,
      headCommitMs: facts.headCommitMs ?? null,
      bundleBuiltAtMs: facts.bundleBuiltAtMs ?? null,
    }),
  };
}

export function rebuildStateDir(
  env: NodeJS.ProcessEnv = process.env,
  home = os.homedir(),
  scope?: { mode?: string | null; port?: string | null },
): string {
  const explicit = env.DEVHUB_CONFIG_DIR?.trim();
  const xdg = env.XDG_CONFIG_HOME?.trim();
  const root = explicit
    ? path.join(explicit, "rebuild")
    : path.join(xdg || path.join(home, ".config"), "devhub", "rebuild");
  // The packaged app and devhub.service must not share a status file. Port
  // splits two apps that both rebuilt in the same mode.
  if (scope?.mode === "service" || scope?.mode === "payload") {
    return path.join(root, scope.mode, scope.port?.trim() || "default");
  }
  return root;
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function lockHeldByLiveProcess(lockFile: string, alive: (pid: number) => boolean = pidAlive): boolean {
  try {
    const owner = JSON.parse(fs.readFileSync(lockFile, "utf8")) as { pid?: unknown };
    return typeof owner.pid === "number" && Number.isInteger(owner.pid) && owner.pid > 0 && alive(owner.pid);
  } catch {
    return false;
  }
}

export interface SpawnLike {
  (cmd: string, args: string[], opts: { cwd?: string; detached?: boolean; stdio?: "ignore"; env?: NodeJS.ProcessEnv }): { unref(): void };
}

export interface ExecFileLike {
  (cmd: string, args: string[], opts: { cwd?: string; timeout?: number }): Promise<{ stdout: string; stderr: string }>;
}

/** Shown when a running rebuild's lock owner is already dead. */
export const REBUILD_INTERRUPTED_ERROR = "The rebuild was interrupted before it finished.";

/** A running status whose owner is gone was killed with the service, not still going. */
export function settleRebuildStatus(stateDir: string, alive: (pid: number) => boolean = pidAlive): RebuildStatus | null {
  const status = readRebuildStatus(stateDir);
  if (!status || status.state !== "running") return status;
  if (lockHeldByLiveProcess(path.join(stateDir, "rebuild.lock"), alive)) return status;
  const interrupted: RebuildStatus = {
    ...status,
    state: "interrupted",
    error: status.error ?? REBUILD_INTERRUPTED_ERROR,
    phases: status.phases.map((phase) =>
      phase?.state === "running" ? { ...phase, state: "interrupted" } : phase,
    ),
  };
  try {
    fs.writeFileSync(path.join(stateDir, "rebuild-status.json"), `${JSON.stringify(interrupted, null, 2)}\n`);
  } catch {
    // The caller still sees interrupted when the status file cannot be rewritten.
  }
  return interrupted;
}

export function systemdRunAvailable(exists: (file: string) => boolean = fs.existsSync): boolean {
  return process.platform === "linux" && (exists("/usr/bin/systemd-run") || exists("/bin/systemd-run"));
}

export function rebuildChildEnv(env: NodeJS.ProcessEnv, execPath: string): NodeJS.ProcessEnv {
  return withNodeToolchain(cleanBuildEnv(env), execPath);
}

/**
 * How long to wait for `systemd-run` to enqueue the transient unit.
 * It returns when the start job finishes, not when the rebuild does.
 */
export const SYSTEMD_RUN_TIMEOUT_MS = 15_000;

/**
 * Names that match the secret regex but are session plumbing, not credentials.
 * DBUS_SESSION_BUS_ADDRESS is the user-bus socket (`systemctl --user` needs it).
 * SSH_AUTH_SOCK is the agent socket `git pull` uses; the value is a path.
 */
const SYSTEMD_ENV_REGEX_EXEMPT = new Set(["DBUS_SESSION_BUS_ADDRESS", "SSH_AUTH_SOCK"]);

/** Drops credential-shaped names, including ones an LC_* prefix would otherwise allow. */
const SECRET_ENV_NAME = /TOKEN|SECRET|KEY|PASSWORD|PASS|AUTH|CREDENTIAL|COOKIE|SESSION/i;

/**
 * Exact variables the rebuild script, git/npm/systemctl, and `next build` read.
 *
 * Audited: `scripts/checkout-rebuild.mjs` (children inherit this env; it sets
 * DEVHUB_DIST_DIR / DEVHUB_VERIFY_BUILD itself on the build step),
 * `desktop/scripts/stage-dashboard.mjs` (DEVHUB_DIST_DIR, DEVHUB_SOURCE_COMMIT,
 * DEVHUB_DESKTOP_BUILD, DEVHUB_SKIP_NEXT_TYPECHECK — the last two it also sets
 * on the next child), `dashboard/next.config.ts` (those plus
 * DEVHUB_ALLOWED_DEV_ORIGINS). `next build` loads `.env.local` itself.
 * GITHUB_ACTIONS is intentionally absent so a local rebuild is not marked as a release.
 */
const SYSTEMD_ENV_EXACT = new Set([
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "TZ",
  "TERM",
  "PATH",
  "XDG_RUNTIME_DIR",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "XDG_CACHE_HOME",
  "DBUS_SESSION_BUS_ADDRESS",
  "WSL_DISTRO_NAME",
  "WSL_INTEROP",
  "NVM_DIR",
  "SSH_AUTH_SOCK",
  "NODE_OPTIONS",
  "DEVHUB_ALLOWED_DEV_ORIGINS",
  "DEVHUB_DESKTOP_BUILD",
  "DEVHUB_DIST_DIR",
  "DEVHUB_SKIP_NEXT_TYPECHECK",
  "DEVHUB_SOURCE_COMMIT",
  "DEVHUB_VERIFY_BUILD",
]);

export function systemdEnvAllowed(name: string): boolean {
  if (SECRET_ENV_NAME.test(name) && !SYSTEMD_ENV_REGEX_EXEMPT.has(name)) return false;
  if (SYSTEMD_ENV_EXACT.has(name)) return true;
  return name.startsWith("LC_");
}

/** `--setenv=` assignments for the transient unit. Secrets and unknown names are omitted. */
export function systemdSetenvArgs(env: NodeJS.ProcessEnv): string[] {
  const kept = new Map<string, string>();
  for (const [rawKey, value] of Object.entries(env)) {
    if (typeof value !== "string" || value.length === 0) continue;
    if (/[\0\n\r]/.test(value)) continue;
    const key = rawKey.toLowerCase() === "path" ? "PATH" : rawKey;
    if (!systemdEnvAllowed(key)) continue;
    kept.set(key, value);
  }
  return [...kept.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key, value]) => `--setenv=${key}=${value}`);
}

export interface LaunchPlan {
  launcher: "systemd-run" | "detached";
  cmd: string;
  args: string[];
}

/**
 * Transient user unit so a service restart cannot kill the rebuild with its cgroup.
 * The unit environment is an allowlist passed with `--setenv`, never `env -i` argv:
 * `env -i` would put every dashboard secret into ExecStart (`ps`, `systemctl show`, journal).
 */
export function launchPlan(input: {
  systemd: boolean;
  execPath: string;
  scriptArgs: string[];
  env: NodeJS.ProcessEnv;
  checkout: string;
  unit: string;
}): LaunchPlan {
  if (!input.systemd) return { launcher: "detached", cmd: input.execPath, args: input.scriptArgs };
  return {
    launcher: "systemd-run",
    cmd: "systemd-run",
    args: [
      "--user",
      "--collect",
      `--unit=${input.unit}`,
      `--working-directory=${input.checkout}`,
      "--property=Description=DevHub checkout rebuild",
      ...systemdSetenvArgs(input.env),
      "--",
      input.execPath,
      ...input.scriptArgs,
    ],
  };
}

function systemdFailureReason(error: unknown): string {
  if (!error || typeof error !== "object") return String(error);
  const err = error as { code?: unknown; stderr?: unknown; message?: unknown; killed?: boolean };
  if (err.killed) return "timed out";
  const stderr = typeof err.stderr === "string" ? err.stderr.trim() : "";
  if (stderr) return stderr.split("\n")[0]?.slice(0, 300) || stderr.slice(0, 300);
  if (typeof err.code === "number" || typeof err.code === "string") return `exit ${err.code}`;
  return typeof err.message === "string" ? err.message : "failed";
}

export async function launchRebuild(
  offer: OfferDecision,
  pull: boolean,
  deps: {
    spawn: SpawnLike;
    lockHeld: (file: string) => boolean;
    scriptPath: string;
    existsSync?: (file: string) => boolean;
    execPath?: string;
    env?: NodeJS.ProcessEnv;
    systemd?: boolean;
    now?: number;
    execFile?: ExecFileLike;
    log?: (line: string) => void;
  },
): Promise<{ ok: true; launcher: "systemd-run" | "detached" } | { ok: false; status: number; error: string }> {
  if (!offer.available || !offer.mode || !offer.checkout) {
    return { ok: false, status: 400, error: offer.reason ?? "Rebuild is not available." };
  }
  const lockFile = path.join(offer.stateDir, "rebuild.lock");
  if (deps.lockHeld(lockFile)) {
    return { ok: false, status: 409, error: "A rebuild is already running." };
  }
  const execPath = deps.execPath ?? process.execPath;
  const systemd = deps.systemd ?? systemdRunAvailable();
  const log = deps.log ?? ((line: string) => console.error(`[rebuild] ${line}`));
  const bundledScript = offer.mode === "payload" && pull && offer.basePayloadDir
    ? path.join(offer.basePayloadDir, "resources", "scripts", "checkout-rebuild.mjs")
    : null;
  const scriptPath = bundledScript && (deps.existsSync ?? fs.existsSync)(bundledScript)
    ? bundledScript
    : deps.scriptPath;
  const scriptArgsFor = (launcher: "systemd-run" | "detached") => {
    const args = [
      scriptPath,
      `--mode=${offer.mode}`,
      `--checkout=${offer.checkout}`,
      `--state=${offer.stateDir}`,
      `--port=${offer.port}`,
      `--launcher=${launcher}`,
    ];
    if (pull) args.push("--pull");
    if (offer.mode === "payload") {
      args.push(`--app-data=${offer.appData}`);
      if (offer.basePayloadDir) args.push(`--base-payload=${offer.basePayloadDir}`);
      if (offer.basePayloadId) args.push(`--base-payload-id=${offer.basePayloadId}`);
    }
    return args;
  };
  // Scrubbed parent env, with this Node's bin first on PATH. The detached
  // fallback keeps it in the process environ (readable by the same user via
  // /proc, not copied into a unit ExecStart, systemctl show, or the journal).
  // The transient unit gets only systemdSetenvArgs.
  const childEnv = rebuildChildEnv(deps.env ?? process.env, execPath);
  const checkout = offer.checkout;

  const spawnDetached = () => {
    const child = deps.spawn(execPath, scriptArgsFor("detached"), {
      cwd: checkout,
      detached: true,
      stdio: "ignore",
      env: childEnv,
    });
    child.unref();
  };

  if (systemd) {
    const plan = launchPlan({
      systemd: true,
      execPath,
      scriptArgs: scriptArgsFor("systemd-run"),
      env: childEnv,
      checkout,
      unit: `devhub-rebuild-${deps.now ?? Date.now()}`,
    });
    if (!deps.execFile) {
      log("systemd-run was not invoked (no runner). Falling back to a detached process.");
      spawnDetached();
      return { ok: true, launcher: "detached" };
    }
    try {
      // Inherit the dashboard process env so systemd-run itself can reach the
      // user bus. Do not pass childEnv here: that object still holds secrets
      // cleanBuildEnv does not drop, and the unit must not receive them.
      await deps.execFile(plan.cmd, plan.args, { cwd: checkout, timeout: SYSTEMD_RUN_TIMEOUT_MS });
      return { ok: true, launcher: "systemd-run" };
    } catch (error) {
      log(`systemd-run did not start the rebuild (${systemdFailureReason(error)}). Falling back to a detached process.`);
      spawnDetached();
      return { ok: true, launcher: "detached" };
    }
  }

  spawnDetached();
  return { ok: true, launcher: "detached" };
}

function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch {
    return null;
  }
}

export function readRebuildStatus(stateDir: string): RebuildStatus | null {
  const parsed = readJsonFile(path.join(stateDir, "rebuild-status.json"));
  if (!parsed || typeof parsed !== "object") return null;
  const status = parsed as Partial<RebuildStatus>;
  if (status.state !== "running" && status.state !== "succeeded" && status.state !== "failed" && status.state !== "refused" && status.state !== "interrupted") {
    return null;
  }
  return {
    state: status.state,
    mode: typeof status.mode === "string" ? status.mode : undefined,
    launcher: typeof status.launcher === "string" ? status.launcher : undefined,
    phase: typeof status.phase === "string" ? status.phase : null,
    phases: Array.isArray(status.phases) ? status.phases : [],
    error: typeof status.error === "string" ? status.error : null,
    rolledBack: status.rolledBack === true,
    restartRequired: status.restartRequired === true,
    commit: typeof status.commit === "string" ? status.commit : null,
    startedAt: typeof status.startedAt === "string" ? status.startedAt : undefined,
    finishedAt: typeof status.finishedAt === "string" || status.finishedAt === null ? status.finishedAt : undefined,
  };
}

export function readRebuildLog(stateDir: string, max = 16_000): string {
  try {
    const text = fs.readFileSync(path.join(stateDir, "rebuild.log"), "utf8");
    return text.length > max ? text.slice(-max) : text;
  } catch {
    return "";
  }
}

function serviceBuildCommit(checkout: string): string | null {
  const parsed = readJsonFile(path.join(checkout, "dashboard", ".next", "devhub-build.json"));
  if (!parsed || typeof parsed !== "object") return null;
  const commit = (parsed as { commit?: unknown }).commit;
  return typeof commit === "string" && commit.trim() ? commit.trim() : null;
}

export async function loadRebuildOffer(env: NodeJS.ProcessEnv = process.env): Promise<RebuildOffer> {
  const checkout = getCheckoutRoot();
  const desktop = env.DEVHUB_DESKTOP === "1";
  const wsl = Boolean(env.WSL_DISTRO_NAME?.trim() || env.WSL_INTEROP?.trim());
  const systemd = Boolean(env.INVOCATION_ID?.trim());
  const modeGuess: RebuildMode | null = desktop && wsl ? "payload" : !desktop && systemd ? "service" : null;
  const port = env.PORT?.trim() || "1337";
  const bundle = modeGuess === "payload" ? readBundleSource() : null;
  const runningCommit = modeGuess === "payload"
    ? bundle?.sourceCommit || bundle?.commit || null
    : modeGuess === "service" && checkout
      ? serviceBuildCommit(checkout)
      : null;

  let headCommit: string | null = null;
  let runningIsAncestor = false;
  let runningKnown = true;
  let headCommitMs: number | null = null;
  if (checkout && runningCommit) {
    try {
      const head = await execExternal("git", ["rev-parse", "HEAD"], { cwd: checkout, timeoutMs: 8_000, label: "rebuild:head" });
      headCommit = head.stdout.trim() || null;
    } catch {
      headCommit = null;
    }
    if (headCommit && headCommit !== runningCommit) {
      try {
        await execExternal("git", ["cat-file", "-e", `${runningCommit}^{commit}`], {
          cwd: checkout,
          timeoutMs: 8_000,
          label: "rebuild:known",
        });
      } catch {
        runningKnown = false;
      }
      if (runningKnown) {
        try {
          await execExternal("git", ["merge-base", "--is-ancestor", runningCommit, "HEAD"], {
            cwd: checkout,
            timeoutMs: 8_000,
            label: "rebuild:ancestor",
          });
          runningIsAncestor = true;
        } catch {
          runningIsAncestor = false;
        }
      } else {
        try {
          const stamp = await execExternal("git", ["log", "-1", "--format=%ct", "HEAD"], {
            cwd: checkout,
            timeoutMs: 8_000,
            label: "rebuild:head-time",
          });
          const seconds = Number(stamp.stdout.trim());
          headCommitMs = Number.isFinite(seconds) ? seconds * 1000 : null;
        } catch {
          headCommitMs = null;
        }
      }
    }
  }

  const decision = classifyRebuild({
    platform: process.platform,
    desktop,
    wsl,
    systemd,
    checkout,
    hasDashboard: Boolean(checkout && fs.existsSync(path.join(checkout, "dashboard", "package.json"))),
    hasScript: Boolean(checkout && fs.existsSync(path.join(checkout, "scripts", "checkout-rebuild.mjs"))),
    runningCommit,
    headCommit,
    runningIsAncestor,
    runningKnown,
    headCommitMs,
    bundleBuiltAtMs: bundle?.builtAtMs ?? null,
    appData: getAppDataDir(),
    basePayloadDir: env.DEVHUB_BASE_PAYLOAD_DIR?.trim() || null,
    basePayloadId: env.DEVHUB_BASE_PAYLOAD_ID?.trim() || null,
    stateDir: rebuildStateDir(env, os.homedir(), { mode: modeGuess, port }),
    port,
  });
  const status = settleRebuildStatus(decision.stateDir);
  return {
    ...decision,
    status: decision.mode === "payload" ? payloadRestartStatus(decision.appData, runningCommit, status) : status,
    log: readRebuildLog(decision.stateDir),
  };
}

export async function startCheckoutRebuild(
  offer: RebuildOffer,
  pull: boolean,
): Promise<{ ok: true; launcher: "systemd-run" | "detached" } | { ok: false; status: number; error: string }> {
  const scriptPath = offer.checkout ? path.join(offer.checkout, "scripts", "checkout-rebuild.mjs") : "";
  return launchRebuild(offer, pull, {
    spawn: (cmd, args, opts) => spawn(cmd, args, opts),
    execFile: (cmd, args, opts) =>
      execExternal(cmd, args, { cwd: opts.cwd, timeoutMs: opts.timeout, label: "rebuild:systemd-run" }),
    lockHeld: (file) => lockHeldByLiveProcess(file),
    scriptPath,
  });
}
