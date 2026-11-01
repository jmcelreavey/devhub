import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { execExternal, type ExecExternalResult } from "../lib/exec-external";
import { terminalPort } from "@devhub/core/local/terminal/port";
import { defaultAppDataDir } from "@shared/storage/profile-state";
import { resolvePluginPaths } from "../lib/plugins/paths";
import { mcpHttpAutostartEnabled } from "../lib/mcp-http-peer";
import { applyCheckoutDevDefaults } from "./checkout-dev-defaults";
import { loadEnvLocalIntoProcessIfUnset } from "./load-env-local-into-process";

const dashboardRoot = process.cwd();
const temporaryRoots: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-checkout-dev-"));
  temporaryRoots.push(root);
  return root;
}

describe("checkout dev defaults", () => {
  it("uses separate ports and disables shared background ownership", () => {
    const root = temporaryRoot();
    const env: Partial<NodeJS.ProcessEnv> = { REPO_ROOT: root };
    applyCheckoutDevDefaults(env);
    expect(env).toEqual({
      REPO_ROOT: root,
      PORT: "1437",
      TERMINAL_PORT: "1439",
      DEVHUB_MCP_HTTP_PORT: "1440",
      DEVHUB_SCHEDULER: "0",
      DEVHUB_AGENT_AUTO_UPDATE: "0",
      DEVHUB_MCP_HTTP: "0",
      DEVHUB_APP_DATA: root,
      DEVHUB_CONFIG_DIR: path.join(root, ".devhub", "config"),
      DEVHUB_CHECKOUT_DEV: "1",
    });
    expect(terminalPort(env)).toBe(1439);
    expect(mcpHttpAutostartEnabled({ ...env, NODE_ENV: "production" })).toBe(false);
    expect(resolvePluginPaths({ home: path.join(root, "home"), env }).pluginHome).toBe(path.join(root, ".devhub", "config", "plugins"));
  });

  it("keeps explicit overrides and the shell-supervised legacy origin", () => {
    const env: Partial<NodeJS.ProcessEnv> = {
      PORT: " 2111 ", TERMINAL_PORT: "2112", DEVHUB_MCP_HTTP_PORT: "2113",
      DEVHUB_SCHEDULER: "1", DEVHUB_DIST_DIR: "custom-dist",
      DEVHUB_APP_DATA: "/linked/data", DEVHUB_CONFIG_DIR: "/linked/config", DEVHUB_MCP_HTTP: "0",
    };
    applyCheckoutDevDefaults(env);
    expect(env).toMatchObject({
      PORT: "2111", TERMINAL_PORT: "2112", DEVHUB_MCP_HTTP_PORT: "2113",
      DEVHUB_SCHEDULER: "1", DEVHUB_DIST_DIR: "custom-dist",
      DEVHUB_APP_DATA: "/linked/data", DEVHUB_CONFIG_DIR: "/linked/config", DEVHUB_MCP_HTTP: "0",
    });
    const supervised: Partial<NodeJS.ProcessEnv> = {
      DEVHUB_SHELL_SUPERVISED: "1", PORT: "1337", TERMINAL_PORT: "1339", DEVHUB_CHECKOUT_DEV: "1",
    };
    applyCheckoutDevDefaults(supervised);
    expect(supervised).toEqual({ DEVHUB_SHELL_SUPERVISED: "1", PORT: "1337", TERMINAL_PORT: "1339" });
  });

  it("uses the checkout when no content root is configured", () => {
    const env: Partial<NodeJS.ProcessEnv> = {};
    applyCheckoutDevDefaults(env);
    expect(env.DEVHUB_APP_DATA).toBe(path.resolve(dashboardRoot, "../.."));
    expect(env.DEVHUB_CONFIG_DIR).toBe(path.join(dashboardRoot, "../..", ".devhub", "config"));
  });

  it.each([undefined, "", "0", "false", "2"])("requires scheduler opt-in before starting checkout MCP (scheduler: %s)", (scheduler) => {
    const env: Partial<NodeJS.ProcessEnv> = { DEVHUB_SCHEDULER: scheduler, DEVHUB_MCP_HTTP: "1" };
    applyCheckoutDevDefaults(env);
    expect(env.DEVHUB_SCHEDULER).toBe("0");
    expect(mcpHttpAutostartEnabled({ ...env, NODE_ENV: "production" })).toBe(false);
  });

  it("allows checkout MCP after scheduler opt-in", () => {
    const env: Partial<NodeJS.ProcessEnv> = { DEVHUB_SCHEDULER: "1" };
    applyCheckoutDevDefaults(env);
    expect(mcpHttpAutostartEnabled({ ...env, NODE_ENV: "production" })).toBe(true);
    expect(env.DEVHUB_AGENT_AUTO_UPDATE).toBe("0");
  });

  it.each(["WSL_DISTRO_NAME", "WSL_INTEROP"])("isolates an unsupervised WSL checkout when %s is set", (key) => {
    const root = temporaryRoot();
    const env: Partial<NodeJS.ProcessEnv> = { [key]: "present", REPO_ROOT: root };
    applyCheckoutDevDefaults(env);
    expect(env).toEqual({
      [key]: "present",
      REPO_ROOT: root,
      PORT: "1437",
      TERMINAL_PORT: "1439",
      DEVHUB_MCP_HTTP_PORT: "1440",
      DEVHUB_SCHEDULER: "0",
      DEVHUB_AGENT_AUTO_UPDATE: "0",
      DEVHUB_MCP_HTTP: "0",
      DEVHUB_APP_DATA: root,
      DEVHUB_CONFIG_DIR: path.join(root, ".devhub", "config"),
      DEVHUB_CHECKOUT_DEV: "1",
    });

    const supervised: Partial<NodeJS.ProcessEnv> = {
      [key]: "present", DEVHUB_SHELL_SUPERVISED: "1", PORT: "1337", TERMINAL_PORT: "1339",
    };
    applyCheckoutDevDefaults(supervised);
    expect(supervised).toEqual({
      [key]: "present", DEVHUB_SHELL_SUPERVISED: "1", PORT: "1337", TERMINAL_PORT: "1339",
    });
  });

  it("respects development-file precedence and only loads requested peer keys", () => {
    const root = temporaryRoot();
    fs.writeFileSync(path.join(root, ".env.development.local"), "TERMINAL_PORT=2112\nPRIVATE_TOKEN=secret\n");
    fs.writeFileSync(path.join(root, ".env.local"), "TERMINAL_PORT=1339\nDEVHUB_SHELL_SUPERVISED=1\n");
    vi.stubEnv("TERMINAL_PORT", undefined);
    vi.stubEnv("DEVHUB_SHELL_SUPERVISED", undefined);
    vi.stubEnv("PRIVATE_TOKEN", undefined);
    loadEnvLocalIntoProcessIfUnset(root, { mode: "development", keys: ["TERMINAL_PORT", "DEVHUB_SHELL_SUPERVISED"] });
    expect(process.env.TERMINAL_PORT).toBe("2112");
    expect(process.env.DEVHUB_SHELL_SUPERVISED).toBe("1");
    expect(process.env.PRIVATE_TOKEN).toBeUndefined();
  });
});

interface SyntheticReady {
  pid: number;
  ports: number[];
  dashboardPort: string;
  terminalPort: string;
  mcpPort: string;
  scheduler: string;
  mcpEnabled?: string;
  configDir?: string;
  distDir?: string;
  appDataDir: string;
}

interface SyntheticProcess {
  result: Promise<ExecExternalResult>;
  ready: () => Promise<SyntheticReady>;
  stop: () => void;
}

function launchFixture(root: string, wsl = false): { start: (kind: "installed" | "checkout") => SyntheticProcess; runtimeFile: string } {
  const fixtureDashboard = path.join(root, "apps/ui");
  const scripts = path.join(fixtureDashboard, "scripts");
  const fixtureProcess = path.join(scripts, "fixture.cjs");
  const home = path.join(root, "home");
  fs.mkdirSync(scripts, { recursive: true });
  fs.writeFileSync(path.join(fixtureDashboard, "package.json"), '{"type":"module"}');
  fs.mkdirSync(path.join(fixtureDashboard, "lib", "plugins"), { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  for (const name of ["checkout-dev-defaults.ts", "load-env-local-into-process.ts"]) {
    const source = fs.readFileSync(path.join(dashboardRoot, "../core/src/scripts", name), "utf8");
    fs.writeFileSync(path.join(scripts, name), source.replace("@devhub/core/local/process-env", "../lib/process-env"));
  }
  fs.writeFileSync(path.join(scripts, "op-secrets.ts"), "import { loadEnvLocalIntoProcessIfUnset } from './load-env-local-into-process'; export async function loadEnvWithOnePasswordFallback(dir: string) { loadEnvLocalIntoProcessIfUnset(dir); }\n");
  fs.writeFileSync(path.join(fixtureDashboard, "lib", "process-env.ts"), "export function augmentedPathEnv() { return { ...process.env }; }\n");
  fs.writeFileSync(path.join(fixtureDashboard, "lib", "plugins", "listener.ts"), "export function listenerHost(_args: string[], fallback: string) { return fallback; }\n");
  fs.writeFileSync(fixtureProcess, `
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
async function main() {
  const kind = process.env.TEST_KIND;
  if (kind === 'checkout') (await import('./checkout-dev-defaults.ts')).applyCheckoutDevDefaults();
  const { getAppDataDir } = require(${JSON.stringify(path.join(dashboardRoot, "../core/src/lib", "desktop", "runtime-paths.ts"))});
  const appDataDir = getAppDataDir();
  fs.mkdirSync(appDataDir, { recursive: true });
  fs.writeFileSync(path.join(appDataDir, 'isolation-marker'), kind);
  if (kind === 'checkout') {
    if (process.env.DEVHUB_SCHEDULER !== '0') throw new Error('Checkout unexpectedly owns background work');
    await require(${JSON.stringify(path.join(dashboardRoot, "../core/src/instrumentation.ts"))}).register();
  } else {
    require(${JSON.stringify(path.join(dashboardRoot, "../core/src/lib", "dashboard-runtime.ts"))}).writeDashboardRuntime();
  }
  const servers = [];
  for (const role of ['dashboard', 'terminal', 'mcp']) {
    const server = http.createServer((_req, res) => res.end(kind + ':' + role));
    await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
    servers.push(server);
  }
  // Write then rename: the test polls for this file and must never read it half-written.
  const readyFile = path.join(process.env.TEST_ROOT, kind + '.ready');
  fs.writeFileSync(readyFile + '.tmp', JSON.stringify({
    pid: process.pid, ports: servers.map(server => server.address().port), dashboardPort: process.env.PORT,
    terminalPort: process.env.TERMINAL_PORT, mcpPort: process.env.DEVHUB_MCP_HTTP_PORT,
    scheduler: process.env.DEVHUB_SCHEDULER, mcpEnabled: process.env.DEVHUB_MCP_HTTP,
    configDir: process.env.DEVHUB_CONFIG_DIR, distDir: process.env.DEVHUB_DIST_DIR,
    appDataDir,
  }));
  fs.renameSync(readyFile + '.tmp', readyFile);
  const timer = setInterval(() => {
    if (!fs.existsSync(path.join(process.env.TEST_ROOT, kind + '.stop'))) return;
    clearInterval(timer);
    for (const server of servers) server.close();
  }, 20);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
`);
  const start = (kind: "installed" | "checkout"): SyntheticProcess => {
    const env: NodeJS.ProcessEnv = {
      HOME: home, PATH: process.env.PATH, NODE_ENV: "test",
      NODE_OPTIONS: `--import ${JSON.stringify(path.join(dashboardRoot, "../../node_modules", "tsx", "dist", "loader.mjs"))}`,
      TSX_TSCONFIG_PATH: path.join(dashboardRoot, "tsconfig.json"),
      TEST_ROOT: root, TEST_KIND: kind, DEVHUB_MCP_HTTP: "1",
      XDG_DATA_HOME: path.join(home, ".local", "share"),
      APPDATA: path.join(home, "AppData", "Roaming"),
      NOTES_DIR: path.join(root, "notes"), TASKS_DIR: path.join(root, "tasks"), REPO_ROOT: root,
      ...(wsl && kind === "checkout" ? { WSL_DISTRO_NAME: "Ubuntu", WSL_INTEROP: "/run/WSL/fixture_interop" } : {}),
      ...(kind === "installed" ? {
        PORT: "1337", TERMINAL_PORT: "1339", DEVHUB_MCP_HTTP_PORT: "1340", DEVHUB_SCHEDULER: "1", DEVHUB_DESKTOP: "1",
      } : {}),
    };
    let failure: unknown;
    const entry = fixtureProcess;
    const result = execExternal(process.execPath, [entry, kind === "checkout" ? "dev" : "start"], {
      cwd: dashboardRoot, env, timeoutMs: 25_000, onStdout: () => undefined,
    });
    void result.catch((error: unknown) => { failure = error; });
    return {
      result,
      ready: async () => {
        const file = path.join(root, `${kind}.ready`);
        const deadline = Date.now() + 15_000;
        while (!fs.existsSync(file) && Date.now() < deadline) {
          if (failure) throw failure;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        if (!fs.existsSync(file)) throw new Error(`${kind} did not start`);
        return JSON.parse(fs.readFileSync(file, "utf8")) as SyntheticReady;
      },
      stop: () => fs.writeFileSync(path.join(root, `${kind}.stop`), ""),
    };
  };
  return { start, runtimeFile: path.join(home, ".config", "devhub", "dashboard.json") };
}

describe("checkout and legacy-installed startup", () => {
  it.each([
    { firstKind: "installed", wsl: false },
    { firstKind: "checkout", wsl: false },
    { firstKind: "installed", wsl: true },
    { firstKind: "checkout", wsl: true },
  ] as const)("keeps data and discovery separate when $firstKind starts first (WSL environment: $wsl)", async ({ firstKind, wsl }) => {
    const root = temporaryRoot();
    const fixture = launchFixture(root, wsl);
    const processes: SyntheticProcess[] = [];
    try {
      const first = fixture.start(firstKind);
      processes.push(first);
      const firstReady = await first.ready();
      if (firstKind === "checkout") expect(fs.existsSync(fixture.runtimeFile)).toBe(false);
      const secondKind = firstKind === "installed" ? "checkout" : "installed";
      const second = fixture.start(secondKind);
      processes.push(second);
      const secondReady = await second.ready();
      const installed = firstKind === "installed" ? firstReady : secondReady;
      const checkout = firstKind === "checkout" ? firstReady : secondReady;
      expect(installed).toMatchObject({ dashboardPort: "1337", terminalPort: "1339", mcpPort: "1340", scheduler: "1" });
      expect(checkout).toMatchObject({ dashboardPort: "1437", terminalPort: "1439", mcpPort: "1440", scheduler: "0", mcpEnabled: "0", configDir: path.join(root, ".devhub", "config") });
      expect(checkout.distDir).toBeUndefined();
      expect(installed.appDataDir).toBe(defaultAppDataDir(path.join(root, "home"), {
        XDG_DATA_HOME: path.join(root, "home", ".local", "share"),
        APPDATA: path.join(root, "home", "AppData", "Roaming"),
      }));
      expect(checkout.appDataDir).toBe(root);
      expect(fs.readFileSync(path.join(installed.appDataDir, "isolation-marker"), "utf8")).toBe("installed");
      expect(fs.readFileSync(path.join(checkout.appDataDir, "isolation-marker"), "utf8")).toBe("checkout");
      expect(new Set([...installed.ports, ...checkout.ports]).size).toBe(6);
      for (const [index, role] of ["dashboard", "terminal", "mcp"].entries()) {
        expect(await (await fetch(`http://127.0.0.1:${installed.ports[index]}`)).text()).toBe(`installed:${role}`);
        expect(await (await fetch(`http://127.0.0.1:${checkout.ports[index]}`)).text()).toBe(`checkout:${role}`);
      }
      expect(JSON.parse(fs.readFileSync(fixture.runtimeFile, "utf8"))).toMatchObject({ pid: installed.pid, port: 1337, kind: "packaged" });
      expect(fs.existsSync(path.join(root, "home", ".local", "state", "devhub", "scheduler.log"))).toBe(false);
      for (const child of processes) child.stop();
      await Promise.all(processes.map((child) => child.result));
    } finally {
      for (const child of processes) child.stop();
      await Promise.allSettled(processes.map((child) => child.result));
    }
  });

  it("rejects the packaged app port for an unsupervised checkout", async () => {
    const root = temporaryRoot();
    const result = await execExternal(process.execPath, [path.join(dashboardRoot, "../../scripts/dev.mjs")], {
      cwd: dashboardRoot,
      env: { HOME: root, PATH: process.env.PATH, PORT: "1337" },
      timeoutMs: 10_000,
    }).then(() => null, (error: Error & { stderr?: string }) => error);
    expect(result?.stderr).toContain("PORT must be a valid checkout port other than 1337");
  });
});
