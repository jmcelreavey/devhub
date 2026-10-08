import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cleanBuildEnv } from "../dashboard/lib/desktop/build-env.mjs";

export async function freeLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

export function startSmokeServer(cmd, args, { cwd, env, log }) {
  const child = spawn(cmd, args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let failure = null;
  child.on("error", (error) => { failure = error; log?.(error.message); });
  child.stdout.on("data", (chunk) => log?.(chunk.toString()));
  child.stderr.on("data", (chunk) => log?.(chunk.toString()));
  const closed = new Promise((resolve) => child.once("close", resolve));
  const killGroup = (signal) => {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  };
  return {
    pid: child.pid,
    exited: () => failure !== null || child.exitCode !== null || child.signalCode !== null,
    async stop() {
      killGroup("SIGTERM");
      let timer;
      try {
        await Promise.race([closed, new Promise((resolve) => { timer = setTimeout(resolve, 1000); })]);
      } finally {
        clearTimeout(timer);
        killGroup("SIGKILL");
      }
      await closed;
    },
  };
}

async function probeHealth(url, timeoutMs, token, pid) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { "x-devhub-token": token } });
    if (!response.ok) return false;
    const body = await response.json();
    return body.devhub === true && body.desktop === true && body.status === "ready" && body.pid === pid;
  } catch {
    return false;
  }
}

export async function smokePayload(payload, deps = {}) {
  const start = deps.start ?? startSmokeServer;
  const probe = deps.probe ?? probeHealth;
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  const port = await (deps.freePort ?? freeLoopbackPort)();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-payload-smoke-"));
  const token = randomBytes(32).toString("hex");
  let server;
  try {
    const env = {
      ...cleanBuildEnv(deps.env ?? process.env),
      HOME: scratch,
      XDG_CONFIG_HOME: path.join(scratch, "config"),
      XDG_DATA_HOME: path.join(scratch, "data"),
      XDG_STATE_HOME: path.join(scratch, "state"),
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      DEVHUB_DESKTOP: "1",
      DEVHUB_BOOTSTRAP_TOKEN: token,
      DEVHUB_SCHEDULER: "0",
      DEVHUB_MCP_HTTP: "0",
      DEVHUB_APP_DATA: scratch,
      DEVHUB_ENV_FILE: path.join(scratch, "config", ".env.local"),
      DEVHUB_RESOURCE_ROOT: path.join(payload, "resources"),
      DEVHUB_SERVER_DIR: path.join(payload, "server"),
      DEVHUB_REPOS_DIR: path.join(scratch, "repos"),
      REPO_ROOT: scratch,
    };
    for (const name of ["notes", "tasks", "docs", "collections", "upstarts"]) {
      env[name.toUpperCase() + "_DIR"] = path.join(scratch, name);
      fs.mkdirSync(path.join(scratch, name), { recursive: true });
    }
    server = start(path.join(payload, "runtime", "node"), [path.join(payload, "server", "server.js")], {
      cwd: path.join(payload, "server"), env, log: deps.log,
    });
    const deadline = now() + (deps.timeoutMs ?? 35_000);
    const url = "http://127.0.0.1:" + port + "/api/desktop/health";
    while (now() < deadline && !server.exited()) {
      if (await probe(url, Math.max(1, Math.min(3000, deadline - now())), token, server.pid)) {
        if (server.exited()) break;
        deps.log?.("Staged payload answered its startup health check.");
        return;
      }
      await sleep(250);
    }
    throw new Error("Staged checkout payload failed its startup health check; the installed payload is unchanged. See the rebuild log.");
  } finally {
    try { await server?.stop(); }
    finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  }
}
