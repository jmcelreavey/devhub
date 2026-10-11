import fs from "node:fs";
import path from "node:path";
import { browserPlatformReason } from "./platform";
import { createBrowserProxy, type BrowserProxy } from "./network";
import { BrowserSurface } from "./surface";
import { createHash, randomUUID } from "node:crypto";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { defaultAppDataDir, getAppDataDir, getResourceRoot } from "@/lib/desktop/runtime-paths";
import { execExternal } from "@/lib/exec-external";
import { withPluginMutationLock } from "@/lib/plugins/lock";
import { getTaskProfileOverview } from "@/lib/tasks/profiles";
import { getActiveTasksDir } from "@/lib/notes/dir";
import { findTask } from "@shared/tasks/store";
import { listTaskAgentRuns } from "@/lib/tasks/task-agent-runs";
import { BrowserLease } from "./lease";
import { approvedUrl, siteOrigin, validatePublicSite, StartBrowserSchema } from "./policy";
import type { BrowserObservation, BrowserSessionView, BrowserStatus } from "./types";

export interface ManagedBrowser {
  view: BrowserSessionView; lease: BrowserLease; browser: Browser; context: BrowserContext; page: Page;
  controller: AbortController; done: Promise<void>; dir: string;
  surface?: BrowserSurface;
  signatures: Map<string, string>; observation?: BrowserObservation; handles: Map<string, import("playwright-core").ElementHandle<SVGElement | HTMLElement>>;
}
interface Runtime { session?: ManagedBrowser; starting: boolean }
const host = globalThis as typeof globalThis & { devhubBrowserRuntime?: Runtime };
const state = host.devhubBrowserRuntime ??= { starting: false };

/**
 * Playwright is loaded only when a session starts.
 *
 * A static import makes Turbopack evaluate `playwright-core` while loading the
 * route. That package `require`s `browsers.json` through a computed path, which
 * the standalone file trace omits. The evaluation throws before the handler —
 * including for an unauthenticated GET — and Next responds with an empty 500.
 */
async function loadPlaywright(): Promise<(endpoint: string) => Promise<Browser>> {
  try {
    const { chromium } = await import("playwright-core");
    return (endpoint) => chromium.connectOverCDP(endpoint, { timeout: 5000 });
  } catch (error) {
    console.error("[browser] playwright-core failed to load", error);
    const detail = error instanceof Error ? error.message : "";
    throw new Error(detail.includes("browsers.json")
      ? "Playwright could not load because browsers.json is missing. Reinstall DevHub."
      : "Playwright could not load. Reinstall DevHub.");
  }
}
export function browserRoot() { return path.join(process.env.DEVHUB_APP_DATA?.trim() ? getAppDataDir() : defaultAppDataDir(), "browser"); }
export function browserProfile() { return getTaskProfileOverview().active ?? "default"; }
function profileDir(profile: string) { return path.join(browserRoot(), "profiles", createHash("sha256").update(profile).digest("hex").slice(0, 24)); }
function supported() { return !browserPlatformReason(); }
function chromeBinary() {
  const candidates = process.platform === "darwin"
    ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
    : ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  return candidates.find((file) => fs.existsSync(file));
}
export function browserStatus(): BrowserStatus {
  const session = state.session;
  if (session?.lease.mode === "agent" && Date.now() >= session.lease.expiresAt) void session.lease.takeover();
  return {
    supported: supported(), installed: Boolean(chromeBinary()),
    reason: browserPlatformReason() ?? (!chromeBinary() ? "Install Google Chrome or Chromium 136 or later, then reload this page." : state.starting ? "Chrome is starting." : undefined),
    session: session ? { ...session.view, mode: session.lease.mode, expiresAt: session.lease.expiresAt || undefined } : null,
  };
}
export function currentBrowser(id?: string) {
  const session = state.session;
  if (!session || (id && id !== session.view.id) || !session.view.ready || session.view.error) throw new Error("The browser session is unavailable. Start it from DevHub.");
  if (session.view.profile !== browserProfile()) throw new Error("Switch back to the browser's work profile or stop it.");
  assertBrowserRun(session.view.taskId, session.view.runId);
  return session;
}
export function assertBrowserRun(taskId: string, runId: string) {
  const task = findTask(getActiveTasksDir(), taskId);
  if (!task || task.done || task.abandonedAt || task.endDate) throw new Error("Choose an active task.");
  if (!listTaskAgentRuns(taskId).some((run) => run.runId === runId && !["failed", "abandoned"].includes(run.status))) throw new Error("Choose a conversation linked to this task.");
}
export async function startBrowser(input: unknown) {
  const connectOverCDP = await loadPlaywright();
  const config = StartBrowserSchema.parse(input);
  const profile = browserProfile();
  const checkOwner = () => {
    if (browserProfile() !== profile) throw new Error("The work profile changed. Review browser access again.");
    assertBrowserRun(config.taskId, config.runId);
  };
  if (!supported()) throw new Error(browserStatus().reason);
  const binary = chromeBinary();
  if (!binary) throw new Error("Install Google Chrome first.");
  if (state.session || state.starting) throw new Error("Stop the current browser before starting another.");
  assertBrowserRun(config.taskId, config.runId);
  const origins = [...new Set(config.origins.map(siteOrigin))];
  state.starting = true;
  let addresses: string[][];
  try { addresses = await Promise.all(origins.map(validatePublicSite)); }
  catch (error) { state.starting = false; throw error; }
  return new Promise<BrowserStatus>((resolve, reject) => {
    void withPluginMutationLock(path.join(browserRoot(), ".owner"), async () => {
      let controller: AbortController | undefined;
      let done: Promise<void> | undefined;
      let directory: string | undefined;
      let proxy: BrowserProxy | undefined;
      try {
        // Leave recent crash remnants alone until the owned supervisor has noticed parent death.
        const temporaryRoot = path.join(browserRoot(), "temporary");
        if (fs.existsSync(temporaryRoot)) for (const name of fs.readdirSync(temporaryRoot)) {
          const remnant = path.join(temporaryRoot, name);
          if (/^[a-f0-9-]{36}$/.test(name) && !fs.lstatSync(remnant).isSymbolicLink() && Date.now() - fs.statSync(remnant).mtimeMs > 60_000) fs.rmSync(remnant, { recursive: true, force: true });
        }
        const version = await execExternal(binary, ["--version"], { timeoutMs: 5000, label: "browser:version" });
        const major = Number(version.stdout.match(/(?:Chrome|Chromium)\s+(\d+)/)?.[1]);
        if (!Number.isFinite(major) || major < 136) throw new Error("Update Chrome to version 136 or later.");
        checkOwner();
        const dir = config.persistent ? profileDir(profile) : path.join(browserRoot(), "temporary", randomUUID());
        directory = dir;
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        fs.chmodSync(dir, 0o700);
        const preferences = path.join(dir, "Default", "Preferences");
        if (!fs.existsSync(preferences)) {
          fs.mkdirSync(path.dirname(preferences), { recursive: true, mode: 0o700 });
          fs.writeFileSync(preferences, JSON.stringify({ profile: { name: "DevHub · " + (config.persistent ? profile : "temporary"), avatar_index: 8 } }), { mode: 0o600 });
        }
        // A live Chrome lock is never removed. Chrome itself decides whether a crash lock is stale.
        fs.rmSync(path.join(dir, "DevToolsActivePort"), { force: true });
        proxy = await createBrowserProxy(origins, addresses);
        controller = new AbortController();
        let exited = false;
        const env: NodeJS.ProcessEnv = { NODE_ENV: "production" };
        for (const key of ["PATH", "HOME", "USER", "LANG", "LC_ALL", "TMPDIR", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"]) if (process.env[key]) env[key] = process.env[key];
        done = execExternal(process.execPath, [path.join(getResourceRoot(), "scripts/owned-runtime.mjs"), String(process.pid), binary,
          "--user-data-dir=" + dir, "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
          "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
          "--dns-over-https-mode=off", "--disable-quic", "--proxy-server=http://127.0.0.1:" + proxy.port,
          "--proxy-bypass-list=<-loopback>", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
          "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-sync", "--disable-background-networking",
          "--disable-component-update", "--disable-session-crashed-bubble", "--disable-features=Translate,MediaRouter",
          "--new-window", "about:blank"], { env, signal: controller.signal, timeoutMs: 2_000_000_000, maxBuffer: 8 * 1024 * 1024, label: "browser:session", managedService: true })
          .then(() => undefined, () => undefined).finally(() => { exited = true; });
        let port = 0;
        for (let attempt = 0; attempt < 150; attempt++) {
          if (exited) throw new Error("Chrome could not start. Close any other DevHub browser window and try again.");
          try { port = Number(fs.readFileSync(path.join(dir, "DevToolsActivePort"), "utf8").split("\n")[0]); } catch { /* Chrome writes this after binding. */ }
          if (Number.isInteger(port) && port > 0 && port < 65536) break;
          await new Promise((finish) => setTimeout(finish, 100));
        }
        if (!port) throw new Error("Chrome did not become ready.");
        const browser = await connectOverCDP("http://127.0.0.1:" + port);
        const context = browser.contexts()[0];
        const page = context.pages()[0] ?? await context.newPage();
        for (const other of context.pages()) if (other !== page) await other.close();
        context.setDefaultTimeout(3000);
        context.setDefaultNavigationTimeout(8000);
        const view: BrowserSessionView = { id: randomUUID(), taskId: config.taskId, runId: config.runId, profile, persistent: config.persistent, mode: "human", origins, ready: false };
        const session: ManagedBrowser = { view, browser, context, page, lease: new BrowserLease(), controller, done, dir, signatures: new Map(), handles: new Map() };
        state.session = session;
        await context.clearPermissions();
        session.surface = new BrowserSurface(session, () => { currentBrowser(session.view.id); });
        await session.surface.initialise();
        await context.route("**/*", async (route) => {
          try {
            const url = route.request().url();
            if (!approvedUrl(url, origins)) { await route.abort("blockedbyclient"); return; }
            await route.continue();
          } catch { await route.abort("blockedbyclient").catch(() => undefined); }
        });
        page.on("framenavigated", (frame) => {
          if (frame !== page.mainFrame()) return;
          session.observation = undefined; session.handles.clear(); view.pending = undefined;
          if (frame.url() !== "about:blank" && !approvedUrl(frame.url(), origins)) void session.lease.takeover();
        });
        await page.goto(origins[0], { waitUntil: "domcontentloaded", timeout: 8000 }).catch(() => { view.notice = "The first site did not finish loading. Check its approved content hosts, or reload in Chrome."; });
        checkOwner();
        view.ready = true;
        state.starting = false;
        resolve(browserStatus());
        await done;
        await session.surface.dispose();
        await session.lease.stop();
        view.ready = false; view.error = "Chrome stopped. Restart it to continue; agent access was revoked.";
      } catch (error) {
        controller?.abort(); await done;
        await state.session?.surface?.dispose();
        state.session = undefined;
        await proxy?.close(); proxy = undefined;
        state.starting = false;
        reject(error);
      } finally {
        await proxy?.close();
        state.starting = false;
        if (!config.persistent && directory) fs.rmSync(directory, { recursive: true, force: true });
      }
    }, { waitMs: 1000 }).catch((error: unknown) => { state.starting = false; reject(error); });
  });
}
export async function stopBrowser() {
  const session = state.session;
  if (!session) return;
  session.view.pending = undefined;
  await session.surface?.dispose();
  await session.lease.stop();
  // Graceful close flushes Chrome's persistent profile; the supervisor is the fallback.
  const fallback = setTimeout(() => session.controller.abort(), 3000);
  try {
    const connection = await session.browser.newBrowserCDPSession();
    await connection.send("Browser.close").catch(() => undefined);
  } catch { /* The process may already have exited; owned shutdown below still completes. */ }
  await session.done; clearTimeout(fallback);
  await session.lease.stop();
  if (state.session === session) state.session = undefined;
}
export async function resetBrowserProfile() {
  if (state.session || state.starting) throw new Error("Stop the browser before clearing saved sign-ins.");
  const profile = browserProfile();
  await withPluginMutationLock(path.join(browserRoot(), ".owner"), async () => {
    if (profile !== browserProfile()) throw new Error("The work profile changed. Review the reset again.");
    fs.rmSync(profileDir(profile), { recursive: true, force: true });
  }, { waitMs: 1000 });
}
