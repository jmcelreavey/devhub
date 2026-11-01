import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execExternal, isExecAbort } from "../exec-external";
import { tryAcquireProcessDirectoryLock } from "../process-lock";
import { PluginApiError, pluginContext, type PluginContext } from "./context";
import { assertSafePath } from "./filesystem";
import { withPluginPathsLock } from "./lock";
import { ensureSecureDir } from "./runtime";
import { loadRuntime, runtimeCatalog, runtimeWorkerOptions, type LoadedRuntime } from "./runtime-host";
import { runtimeFile } from "./runtime-files";
import { runtimeEnvironmentValues } from "./runtime-environment";
import { startRuntimeDataSync } from "./runtime-data-sync";
import { startRuntimeServiceTasks } from "./runtime-service-tasks";
import { findEntry } from "./views";

interface ServiceConsent { digest: string; nonce: string }
export interface RuntimeServiceStatus {
  state: "running" | "waiting" | "retrying" | "failed";
  attempts: number;
}
interface ServiceState extends RuntimeServiceStatus {
  nonce: string;
  environment: string;
  nextStart: number;
  controller?: AbortController;
  done?: Promise<void>;
}

function servicePaths(ctx: PluginContext, id: string) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error("Invalid service owner identifier");
  const dir = path.join(ctx.paths.configDir, "runtime-services");
  const consent = path.join(dir, `${id}.json`);
  const lock = path.join(dir, `${id}.lock`);
  for (const file of [dir, consent, lock]) assertSafePath(ctx.paths.configDir, file);
  return { dir, consent, lock };
}

function serviceDigest(plugin: LoadedRuntime): string {
  return crypto.createHash("sha256").update(JSON.stringify([plugin.id, plugin.root, plugin.revision])).digest("hex");
}

function serviceEnvironment(ctx: PluginContext, plugin: LoadedRuntime): string {
  const values = Object.entries(runtimeEnvironmentValues(plugin.runtime, ctx.env)).sort(([left], [right]) => left.localeCompare(right));
  return crypto.createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

function readConsent(ctx: PluginContext, plugin: LoadedRuntime): ServiceConsent | null {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(servicePaths(ctx, plugin.id).consent, "utf8"));
    if (!value || typeof value !== "object") return null;
    const consent = value as ServiceConsent;
    return consent.digest === serviceDigest(plugin) && typeof consent.nonce === "string" ? consent : null;
  } catch { return null; } // Missing, unsafe or malformed consent always leaves the service off.
}

export function reviewRuntimeService(ctx: PluginContext, name: string) {
  const plugin = loadRuntime(ctx, name);
  const service = plugin.runtime.capabilities?.service;
  if (!service) throw new PluginApiError(404, "SERVICE_MISSING", "This plugin has no reviewed background service.");
  if (process.platform === "win32" && plugin.runtime.permissions.exec) throw new PluginApiError(409, "SERVICE_PLATFORM", "Background services that start child processes need process-tree cleanup on Windows before they can run.");
  return { plugin, service, digest: serviceDigest(plugin), enabled: !!readConsent(ctx, plugin) };
}

/** Installation never starts a socket. Opt-in is bound to the complete reviewed snapshot. */
export async function approveRuntimeService(ctx: PluginContext, name: string, digest: string): Promise<void> {
  await withPluginPathsLock(ctx.paths, async () => {
    const review = reviewRuntimeService(ctx, name);
    if (digest !== review.digest) throw new PluginApiError(409, "SERVICE_CHANGED", "This service changed. Review it again before enabling it.");
    const files = servicePaths(ctx, review.plugin.id);
    ensureSecureDir(files.dir);
    const temporary = `${files.consent}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ digest, nonce: crypto.randomUUID() }), { mode: 0o600, flag: "wx" });
      fs.renameSync(temporary, files.consent);
    } finally { fs.rmSync(temporary, { force: true }); }
  });
}

export async function revokeRuntimeService(ctx: PluginContext, name: string): Promise<void> {
  await withPluginPathsLock(ctx.paths, async () => {
    const entry = findEntry(ctx, name);
    if (!entry) throw new PluginApiError(404, "SERVICE_MISSING", "This plugin is no longer registered.");
    fs.rmSync(servicePaths(ctx, entry.id).consent, { force: true });
  });
}

/**
 * Register the child in the same lease before importing plugin code. If the
 * dashboard is killed, stale-lock recovery must wait for this child to die.
 * The parent token checks also cover a dashboard dying during spawn.
 */
function guardedEntry(plugin: LoadedRuntime, lock: string, owner: string): string {
  return `import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const parent = ${process.pid};
const lock = ${JSON.stringify(lock)};
const owner = ${JSON.stringify(owner)};
const child = lock + '/child-' + process.pid;
function stop() {
  if (process.platform !== 'win32') { try { process.kill(-process.pid, 'SIGKILL'); } catch {} }
  process.exit(1);
}
function parentAlive() {
  if (process.ppid !== parent) return false;
  try { process.kill(parent, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
if (!parentAlive() || !fs.existsSync(lock + '/' + owner)) stop();
fs.writeFileSync(child, JSON.stringify({pid:process.pid}), {flag:'wx',mode:0o600});
if (!parentAlive() || !fs.existsSync(lock + '/' + owner)) stop();
setInterval(() => { if (!parentAlive()) stop(); }, 250).unref();
process.on('exit', () => { if (process.platform !== 'win32') { try { process.kill(-process.pid, 'SIGKILL'); } catch {} } });
await import(pathToFileURL(${JSON.stringify(runtimeFile(plugin.root, plugin.runtime.entry))}).href);`;
}

/** Owns connections only. Requests and writes are never queued or replayed here. */
export class RuntimeServiceSupervisor {
  private services = new Map<string, ServiceState>();
  private timer?: ReturnType<typeof setInterval>;
  private reconciling?: Promise<void>;
  private stopped = false;

  constructor(private ctx: PluginContext, private options: { pollMs?: number; retryMs?: number } = {}) {}

  start(): void {
    if (this.ctx.env.DEVHUB_SCHEDULER === "0") throw new PluginApiError(409, "SERVICE_SECONDARY", "Background services run on the primary dashboard only.");
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => { void this.reconcile().catch(() => console.error("[plugins] background service review failed; services stopped")); }, this.options.pollMs ?? 1000);
    this.timer.unref();
    void this.reconcile().catch(() => console.error("[plugins] background service review failed; services stopped"));
  }

  status(): Record<string, RuntimeServiceStatus> {
    return Object.fromEntries([...this.services].map(([name, value]) => [name, { state: value.state, attempts: value.attempts }]));
  }

  reconcile(): Promise<void> {
    if (this.ctx.env.DEVHUB_SCHEDULER === "0") return Promise.reject(new PluginApiError(409, "SERVICE_SECONDARY", "Background services run on the primary dashboard only."));
    return this.reconciling ??= this.refresh().catch(async () => {
      await this.stopWorkers();
      throw new Error("Service catalogue unavailable");
    }).finally(() => { this.reconciling = undefined; });
  }

  private async refresh(): Promise<void> {
    if (this.stopped) return;
    const desired = new Map<string, { plugin: LoadedRuntime; consent: ServiceConsent; environment: string }>();
    for (const plugin of runtimeCatalog(this.ctx)) {
      if (!plugin.runtime.capabilities?.service || process.platform === "win32" && plugin.runtime.permissions.exec) continue;
      const consent = readConsent(this.ctx, plugin);
      if (consent) {
        desired.set(plugin.name, { plugin, consent, environment: serviceEnvironment(this.ctx, plugin) });
      }
    }
    for (const [name, state] of this.services) {
      const next = desired.get(name);
      if (next?.consent.nonce === state.nonce && next.environment === state.environment) continue;
      state.controller?.abort();
      await state.done;
      this.services.delete(name);
    }
    if (this.stopped) return;
    for (const [name, { plugin, consent, environment }] of desired) {
      let state = this.services.get(name);
      if (!state) {
        state = { nonce: consent.nonce, environment, state: "waiting", attempts: 0, nextStart: 0 };
        this.services.set(name, state);
      }
      if (state.controller || state.state === "failed" || Date.now() < state.nextStart) continue;
      const files = servicePaths(this.ctx, plugin.id);
      ensureSecureDir(files.dir);
      const release = tryAcquireProcessDirectoryLock(files.lock);
      if (!release) { state.state = "waiting"; continue; }
      // Retiring another worker awaited close; re-check what is registered now.
      let currentConsent: ServiceConsent | null = null;
      try {
        const current = loadRuntime(this.ctx, name);
        if (serviceDigest(current) === serviceDigest(plugin)) currentConsent = readConsent(this.ctx, current);
      } catch { /* Disabled, replaced or unreviewed workers stay stopped. */ }
      if (currentConsent?.nonce !== consent.nonce) { release(); continue; }
      const controller = new AbortController();
      state.controller = controller;
      state.state = "running";
      state.done = this.run(plugin, state, controller, files.lock, release);
    }
  }

  private async run(plugin: LoadedRuntime, state: ServiceState, controller: AbortController, lock: string, release: (() => void) & { owner: string }): Promise<void> {
    const started = Date.now();
    let dataSync: Awaited<ReturnType<typeof startRuntimeDataSync>> | undefined;
    let taskHost: Awaited<ReturnType<typeof startRuntimeServiceTasks>> | undefined;
    try {
      const { data, args, env } = runtimeWorkerOptions(this.ctx, plugin);
      if (plugin.runtime.permissions.network.includes("127.0.0.1")) {
        dataSync = await startRuntimeDataSync(data);
        env.DEVHUB_RUNTIME_DATA_SYNC = dataSync.environment;
      }
      const tasks = plugin.runtime.capabilities?.service?.tasks;
      if (tasks?.length) {
        taskHost = await startRuntimeServiceTasks(tasks, () => {
          if (controller.signal.aborted) return false;
          try {
            const current = loadRuntime(this.ctx, plugin.name);
            return serviceDigest(current) === serviceDigest(plugin) && readConsent(this.ctx, current)?.nonce === state.nonce
              && serviceEnvironment(this.ctx, current) === state.environment;
          } catch { return false; }
        });
        env.DEVHUB_RUNTIME_SERVICE_TASKS = taskHost.environment;
      }
      args.push(`--allow-fs-read=${lock}`, `--allow-fs-write=${lock}`, "--input-type=module", "--eval", guardedEntry(plugin, lock, release.owner));
      await execExternal(process.execPath, args, {
        cwd: data, env, signal: controller.signal, managedService: true,
        input: JSON.stringify({ kind: "service", path: plugin.runtime.capabilities!.service!.id, method: "START" }),
        timeoutMs: plugin.runtime.capabilities!.service!.maxRunSeconds * 1000,
        maxBuffer: 256 * 1024, label: `plugin-service:${plugin.name}`,
      });
    } catch (error) {
      if (isExecAbort(error)) return;
      // Child output can contain credentials; retain only a generic state.
    } finally {
      try { await taskHost?.close(); }
      catch { state.state = "failed"; }
      try { await dataSync?.close(); }
      catch { state.state = "failed"; }
      try { release(); }
      catch { state.state = "failed"; }
      state.controller = undefined;
      if (!controller.signal.aborted && state.state !== "failed") {
        if (Date.now() - started >= 60_000) state.attempts = 0;
        state.attempts += 1;
        state.state = state.attempts >= 5 ? "failed" : "retrying";
        state.nextStart = Date.now() + Math.min(30_000, (this.options.retryMs ?? 1000) * 2 ** (state.attempts - 1));
      }
    }
  }

  private async stopWorkers(): Promise<void> {
    for (const state of this.services.values()) state.controller?.abort();
    await Promise.all([...this.services.values()].map((state) => state.done));
    this.services.clear();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    for (const state of this.services.values()) state.controller?.abort();
    try { await this.reconciling; }
    finally { await this.stopWorkers(); }
  }
}

const host = globalThis as typeof globalThis & { runtimeServiceSupervisor?: RuntimeServiceSupervisor };
export function startRuntimeServices(): void {
  if (process.env.DEVHUB_SCHEDULER === "0" || host.runtimeServiceSupervisor) return;
  const supervisor = new RuntimeServiceSupervisor(pluginContext());
  host.runtimeServiceSupervisor = supervisor;
  supervisor.start();
  const stop = () => { void supervisor.stop().catch(() => console.error("[plugins] background service shutdown failed")); };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  process.once("exit", stop);
}
