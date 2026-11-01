import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ui = path.join(root, "apps/ui");
const uiRequire = createRequire(path.join(ui, "package.json"));
const windows = process.platform === "win32";

function checkedPort(name, fallback) {
  const value = process.env[name]?.trim() || fallback;
  const port = Number(value);
  const shellPort = (process.env.DEVHUB_SHELL_SUPERVISED === "1" || Boolean(process.env.INVOCATION_ID)) && { PORT: 1337, TERMINAL_PORT: 1339, DEVHUB_MCP_HTTP_PORT: 1340 }[name] === port;
  if (!/^\d+$/.test(value) || port < 1 || port > 65535 || ([1337, 1339, 1340].includes(port) && !shellPort)) {
    throw new Error(`${name} must be a valid checkout port other than 1337, 1339 or 1340`);
  }
  return port;
}

async function freePort(excluded) {
  for (;;) {
    const server = createNetServer();
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const port = server.address().port;
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (!excluded.includes(port)) return port;
  }
}

async function runVite() {
  const vite = path.join(path.dirname(uiRequire.resolve("vite/package.json")), "dist/node/index.js");
  const { createServer } = await import(pathToFileURL(vite).href);
  const server = await createServer({
    root: ui,
    server: {
      host: "127.0.0.1", port: Number(process.env.PORT), strictPort: true,
      fs: { allow: [ui, path.join(root, "apps/core"), path.join(root, "packages/shared"), path.join(root, "node_modules")] },
      proxy: { "^/api(?:/|\\?|$)": { target: `http://127.0.0.1:${process.env.DEVHUB_INTERNAL_CORE_PORT}`, changeOrigin: false } },
    },
  });
  try { await server.listen(); } catch (error) { await server.close(); throw error; }
  server.printUrls();
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { void server.close().finally(() => process.exit(0)); });
}

// Windows has no POSIX process groups. taskkill /T terminates the child tree,
// including tsx/esbuild descendants, while its root PID is still known.
function terminateTree(child, signal) {
  if (!child.pid) return;
  if (windows) {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    killer.on("error", error => { console.error("[dev] taskkill failed:", error); child.kill(); });
    const timeout = setTimeout(() => killer.kill(), 3000);
    killer.once("close", () => clearTimeout(timeout));
  } else {
    try { process.kill(-child.pid, signal); }
    catch (error) { if (error.code !== "ESRCH") console.error(`[dev] Could not send ${signal}:`, error); }
  }
}

async function supervise(production) {
  const { tsImport } = uiRequire("tsx/esm/api");
  const { loadEnvLocalIntoProcessIfUnset } = await tsImport(pathToFileURL(path.join(root, "apps/core/src/scripts/load-env-local-into-process.ts")).href, import.meta.url);
  loadEnvLocalIntoProcessIfUnset(ui, { mode: "development", keys: ["PORT", "TERMINAL_PORT", "DEVHUB_MCP_HTTP_PORT", "DEVHUB_BASE_URL", "GOOGLE_OAUTH_REDIRECT_URI", "DEVHUB_APP_DATA", "DEVHUB_TERMINAL_LOG_DIR", "REPO_ROOT", "DEVHUB_SCHEDULER", "DEVHUB_MCP_HTTP"] });
  const shell = process.env.DEVHUB_SHELL_SUPERVISED === "1" || Boolean(process.env.INVOCATION_ID);
  if (shell) process.env.DEVHUB_SHELL_SUPERVISED = "1";
  const { applyCheckoutDevDefaults } = await tsImport(pathToFileURL(path.join(root, "apps/core/src/scripts/checkout-dev-defaults.ts")).href, import.meta.url);
  applyCheckoutDevDefaults();
  const port = checkedPort("PORT", shell ? "1337" : "1437");
  const terminalPort = checkedPort("TERMINAL_PORT", shell ? "1339" : "1439");
  const mcpPort = checkedPort("DEVHUB_MCP_HTTP_PORT", shell ? "1340" : "1440");
  if (new Set([port, terminalPort, mcpPort]).size !== 3) throw new Error("PORT, TERMINAL_PORT and DEVHUB_MCP_HTTP_PORT must differ");
  const corePort = production ? port : await freePort([port, terminalPort, mcpPort, 1337, 1339, 1340]);
  const env = {
    ...process.env,
    PORT: String(port), TERMINAL_PORT: String(terminalPort), DEVHUB_MCP_HTTP_PORT: String(mcpPort),
    DEVHUB_INTERNAL_CORE_PORT: String(corePort), DEVHUB_PUBLIC_PORT: String(port), DEVHUB_SUPERVISED: "1", NODE_ENV: production ? "production" : "development",
    DEVHUB_BASE_URL: process.env.DEVHUB_BASE_URL || `http://127.0.0.1:${port}`,
    GOOGLE_OAUTH_REDIRECT_URI: process.env.GOOGLE_OAUTH_REDIRECT_URI || `http://localhost:${port}/api/calendar/auth/callback`,
    TSX_TSCONFIG_PATH: path.join(ui, "tsconfig.json"),
  };
  const children = new Map();
  const timers = new Set();
  let stopping = false;
  function stop(signal) {
    if (stopping) return;
    stopping = true;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const child of children.values()) terminateTree(child, signal);
    if (!windows && children.size) {
      const timer = setTimeout(() => { for (const child of children.values()) terminateTree(child, "SIGKILL"); }, 5000);
      timer.unref();
    }
  }
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => stop(signal));
  function launch(name, command, args, childEnv, restart) {
    const child = spawn(command, args, { cwd: ui, env: childEnv, stdio: "inherit", detached: !windows, windowsHide: true });
    children.set(name, child);
    const started = Date.now();
    console.log(`[dev] ${name} starting (pid ${child.pid ?? "unavailable"})`);
    child.on("error", error => console.error(`[dev] ${name} failed to start:`, error));
    child.once("exit", () => { if (!stopping) terminateTree(child, "SIGKILL"); });
    child.once("close", (code, signal) => {
      children.delete(name);
      if (stopping || !restart) return;
      const delay = Date.now() - started >= 30000 ? 1000 : restart.delay;
      restart.delay = Math.min(delay * 2, 30000);
      console.error(`[dev] ${name} exited (${signal || code}); restarting in ${delay}ms`);
      const timer = setTimeout(() => { timers.delete(timer); if (!stopping) launch(name, command, args, childEnv, restart); }, delay);
      timers.add(timer);
    });
    return child;
  }
  if (!production) {
    const npm = process.env.npm_execpath;
    const command = npm ? process.execPath : (windows ? process.env.ComSpec || "cmd.exe" : "npm");
    // launch() runs in apps/ui, so the workspace's own predev is the local script (a -w path would resolve to apps/ui/apps/ui).
    const args = npm ? [npm, "run", "predev"] : windows ? ["/d", "/s", "/c", "npm.cmd run predev"] : ["run", "predev"];
    const predev = launch("predev", command, args, env, null);
    const result = await new Promise(resolve => { predev.once("error", () => resolve(1)); predev.once("close", (code, signal) => resolve(signal ? 1 : (code ?? 1))); });
    if (stopping) return;
    if (result !== 0) throw new Error(`predev failed (${result})`);
  }
  const coreEnv = { ...env, PORT: String(corePort), DEVHUB_BIND_HOST: "127.0.0.1" };
  launch("core", process.execPath, ["--import", "tsx", path.join(root, "scripts/core-server.ts")], coreEnv, { delay: 1000 });
  if (!production) launch("vite", process.execPath, [fileURLToPath(import.meta.url), "--vite"], env, { delay: 1000 });
  launch("terminal", process.execPath, ["--import", "tsx", path.join(root, "apps/core/src/local/terminal/server.ts")], env, { delay: 1000 });
  console.log(`[dev] dashboard http://127.0.0.1:${port}; core 127.0.0.1:${corePort}; terminal 127.0.0.1:${terminalPort}`);
}

if (process.argv[2] === "--vite") runVite().catch(error => { console.error("[dev] Vite failed:", error); process.exitCode = 1; });
else supervise(process.argv[2] === "--production").catch(error => { console.error("[dev] Startup failed:", error); process.exitCode = 1; });
