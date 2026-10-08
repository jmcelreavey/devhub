import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { execExternal } from "@/lib/exec-external";
import { readBundleSourceCommit } from "@/lib/desktop/bundle-source";
import { getAppDataDir, getCheckoutRoot } from "@/lib/desktop/runtime-paths";

export type RebuildMode = "service" | "payload";

export interface RebuildPhase {
  id: string;
  label: string;
  state: string;
}

export interface RebuildStatus {
  state: "running" | "succeeded" | "failed" | "refused";
  mode?: string;
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

export function checkoutIsAhead(running: string | null, head: string | null, runningIsAncestor: boolean): boolean {
  if (!running || !head || running === head) return false;
  return runningIsAncestor;
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
    checkoutAhead: checkoutIsAhead(facts.runningCommit, facts.headCommit, facts.runningIsAncestor),
  };
}

export function rebuildStateDir(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
  const explicit = env.DEVHUB_CONFIG_DIR?.trim();
  if (explicit) return path.join(explicit, "rebuild");
  const xdg = env.XDG_CONFIG_HOME?.trim();
  return path.join(xdg || path.join(home, ".config"), "devhub", "rebuild");
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

export function launchRebuild(
  offer: OfferDecision,
  pull: boolean,
  deps: { spawn: SpawnLike; lockHeld: (file: string) => boolean; scriptPath: string },
): { ok: true } | { ok: false; status: number; error: string } {
  if (!offer.available || !offer.mode || !offer.checkout) {
    return { ok: false, status: 400, error: offer.reason ?? "Rebuild is not available." };
  }
  const lockFile = path.join(offer.stateDir, "rebuild.lock");
  if (deps.lockHeld(lockFile)) {
    return { ok: false, status: 409, error: "A rebuild is already running." };
  }
  const args = [
    deps.scriptPath,
    `--mode=${offer.mode}`,
    `--checkout=${offer.checkout}`,
    `--state=${offer.stateDir}`,
    `--port=${offer.port}`,
  ];
  if (pull) args.push("--pull");
  if (offer.mode === "payload") {
    args.push(`--app-data=${offer.appData}`);
    if (offer.basePayloadDir) args.push(`--base-payload=${offer.basePayloadDir}`);
    if (offer.basePayloadId) args.push(`--base-payload-id=${offer.basePayloadId}`);
  }
  const child = deps.spawn(process.execPath, args, { cwd: offer.checkout, detached: true, stdio: "ignore" });
  child.unref();
  return { ok: true };
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
  if (status.state !== "running" && status.state !== "succeeded" && status.state !== "failed" && status.state !== "refused") {
    return null;
  }
  return {
    state: status.state,
    mode: typeof status.mode === "string" ? status.mode : undefined,
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
  const runningCommit = modeGuess === "payload"
    ? readBundleSourceCommit()
    : modeGuess === "service" && checkout
      ? serviceBuildCommit(checkout)
      : null;

  let headCommit: string | null = null;
  let runningIsAncestor = false;
  if (checkout && runningCommit) {
    try {
      const head = await execExternal("git", ["rev-parse", "HEAD"], { cwd: checkout, timeoutMs: 8_000, label: "rebuild:head" });
      headCommit = head.stdout.trim() || null;
    } catch {
      headCommit = null;
    }
    if (headCommit && headCommit !== runningCommit) {
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
    appData: getAppDataDir(),
    basePayloadDir: env.DEVHUB_BASE_PAYLOAD_DIR?.trim() || null,
    basePayloadId: env.DEVHUB_BASE_PAYLOAD_ID?.trim() || null,
    stateDir: rebuildStateDir(env),
    port: env.PORT?.trim() || "1337",
  });
  return { ...decision, status: readRebuildStatus(decision.stateDir), log: readRebuildLog(decision.stateDir) };
}

export function startCheckoutRebuild(offer: RebuildOffer, pull: boolean): { ok: true } | { ok: false; status: number; error: string } {
  const scriptPath = offer.checkout ? path.join(offer.checkout, "scripts", "checkout-rebuild.mjs") : "";
  return launchRebuild(offer, pull, {
    spawn: (cmd, args, opts) => spawn(cmd, args, opts),
    lockHeld: (file) => lockHeldByLiveProcess(file),
    scriptPath,
  });
}
