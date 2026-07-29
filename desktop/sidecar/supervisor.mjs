/**
 * The Node sidecar: one process that owns the dashboard and its peers.
 *
 * Rust starts exactly this file and nothing else. Everything the app needs at
 * runtime hangs off it, in one process group, so shutdown is "kill the group I
 * started" rather than "find things listening on ports and hope they're mine".
 * Killing by port is how a launcher takes down somebody's unrelated dev server.
 *
 * What it deliberately does NOT do:
 * - install anything
 * - build anything
 * - choose between dev and production
 * - shell out to npm, tsx, or concurrently
 *
 * All of those were the Electron launcher's job and all of them are reasons an
 * installed app can fail on a machine that is not this developer's.
 */
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { fork, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Structured progress for the Rust shell. One JSON object per line on stdout. */
function emit(event) {
  process.stdout.write(`${JSON.stringify({ devhubSidecar: true, ...event })}\n`);
}

function log(message) {
  process.stderr.write(`[sidecar] ${message}\n`);
}

/**
 * Keys the shell owns absolutely. The config file cannot change these.
 *
 * These are infrastructure, not preferences: where the bundle is, which ports
 * were checked and reserved, and the per-launch bootstrap token. A stale or
 * hand-edited `.env.local` that could move the resource root, change the port
 * the shell is already waiting on, or — worst — set the bootstrap token would
 * break startup at best and defeat the auth boundary at worst.
 */
const SHELL_OWNED = new Set([
  "DEVHUB_DESKTOP",
  "DEVHUB_APP_DATA",
  "DEVHUB_RESOURCE_ROOT",
  "DEVHUB_SERVER_DIR",
  "DEVHUB_ENV_FILE",
  "DEVHUB_BOOTSTRAP_TOKEN",
  "PORT",
  "TERMINAL_PORT",
  "NODE_ENV",
]);

/**
 * Load `DEVHUB_ENV_FILE` before anything starts.
 *
 * This is the difference between "the config file is supported" and "the config
 * file works". Read/write support in the dashboard is useless if the process
 * tree was already spawned without those values — the LAN bind host, the
 * OpenChamber password, and every integration credential are read at startup by
 * children that would otherwise never see them.
 *
 * **The config file wins over the shell's defaults for everything except
 * `SHELL_OWNED`.** This is the opposite of what it originally did, and the
 * original was wrong in a way that only showed up when a real migration ran:
 * Rust sets `NOTES_DIR` to `<app-data>/notes` as a sensible default, so a user
 * who migrated with "keep my notes where they are" had their choice silently
 * ignored and opened the app to an empty vault. Their data was fine — the app
 * was looking in the wrong place, which is arguably worse, because it looks
 * like data loss.
 *
 * Content directories are the user's decision. The shell provides a default for
 * a fresh install and gets out of the way when the user has said otherwise.
 */
function loadEnvFile(envFile) {
  if (!envFile || !fs.existsSync(envFile)) return {};
  const loaded = {};
  const raw = fs.readFileSync(envFile, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!key || !value) continue;
    if (SHELL_OWNED.has(key)) {
      if (process.env[key] !== undefined && process.env[key] !== value) {
        log(`ignoring ${key} from the config file — the shell owns that value`);
      }
      continue;
    }
    process.env[key] = value;
    loaded[key] = value;
  }
  return loaded;
}

/**
 * Repair the GUI `PATH`.
 *
 * A process launched from Finder inherits a minimal `PATH` — typically just
 * `/usr/bin:/bin:/usr/sbin:/sbin`. It does not include Homebrew, nvm, or the
 * user-local bins where `openchamber`, `opencode`, `gh` and agent CLIs actually
 * live. The Electron launcher repaired this explicitly; the first desktop
 * builds did not, and the symptom was peer services exiting with code 1 while
 * the binaries sat installed and working in a normal terminal.
 *
 * Deliberately additive and deliberately last: the user's own `PATH` entries
 * keep priority, and these are appended as fallbacks rather than shadowing
 * anything they have configured.
 */
function repairedPath() {
  const home = process.env.HOME ?? "";
  const nodeDir = path.dirname(process.execPath);
  const extras = [
    nodeDir,
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/opt/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ];
  if (home) {
    extras.push(
      path.join(home, ".opencode", "bin"),
      path.join(home, ".npm", "bin"),
      path.join(home, ".local", "bin"),
      path.join(home, "bin"),
      path.join(home, ".cargo", "bin"),
      path.join(home, ".bun", "bin"),
    );
    // nvm installs each Node version under its own directory, and whichever is
    // current owns the globally-installed CLIs. Add every version rather than
    // guessing which one — a missing entry is a CLI the user "has" but the app
    // cannot see.
    const nvm = path.join(home, ".nvm", "versions", "node");
    try {
      const versions = fs
        .readdirSync(nvm)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      for (const version of versions) {
        extras.push(path.join(nvm, version, "bin"));
      }
    } catch {
      /* no nvm on this machine */
    }
  }

  const current = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const seen = new Set(current);
  for (const dir of extras) {
    if (!seen.has(dir)) {
      current.push(dir);
      seen.add(dir);
    }
  }
  return current.join(path.delimiter);
}

/** Resolve once, hand to every child. No child re-reads the config file. */
function managedEnv() {
  return { ...process.env, PATH: repairedPath() };
}

function waitForPort(port, host, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ port, host });
      const fail = () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`Timed out waiting for ${host}:${port} after ${timeoutMs}ms`));
          return;
        }
        setTimeout(attempt, 150);
      };
      socket.once("connect", () => {
        socket.end();
        resolve();
      });
      socket.once("error", fail);
      socket.setTimeout(1000, fail);
    };
    attempt();
  });
}

const children = new Set();

function track(child, label) {
  children.add({ child, label });
  child.on("exit", (code, signal) => {
    for (const entry of children) {
      if (entry.child === child) children.delete(entry);
    }
    // A peer dying is not fatal; Next dying is. The caller decides which.
    log(`${label} exited (code ${code ?? "null"}, signal ${signal ?? "none"})`);
  });
  return child;
}

/**
 * Stop every child we started, then ourselves.
 *
 * SIGTERM first with a real grace window: Next flushes, the PTY server closes
 * its sockets and finishes writing session logs. SIGKILL only for what is still
 * alive afterwards. Nothing here looks at ports.
 */
async function shutdown(code = 0) {
  emit({ state: "stopping" });
  for (const { child, label } of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      log(`could not signal ${label}`);
    }
  }
  const deadline = Date.now() + 4000;
  while (children.size > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  for (const { child, label } of children) {
    log(`force-killing ${label}`);
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
  process.exit(code);
}

async function main() {
  const resourceRoot = process.env.DEVHUB_RESOURCE_ROOT;
  const serverDir = process.env.DEVHUB_SERVER_DIR ?? path.resolve(here, "..", "server");
  const port = Number.parseInt(process.env.PORT ?? "1337", 10);
  const terminalPort = Number.parseInt(process.env.TERMINAL_PORT ?? "1339", 10);
  const host = "127.0.0.1";

  const loaded = loadEnvFile(process.env.DEVHUB_ENV_FILE);
  if (Object.keys(loaded).length > 0) {
    log(`loaded ${Object.keys(loaded).length} keys from DEVHUB_ENV_FILE`);
  }

  emit({ state: "preparing", port, terminalPort });

  const serverEntry = path.join(serverDir, "server.js");
  if (!fs.existsSync(serverEntry)) {
    emit({ state: "failed", error: `Missing packaged server at ${serverEntry}` });
    log(`missing ${serverEntry} — the bundle is incomplete`);
    process.exit(2);
  }
  if (!resourceRoot || !fs.existsSync(resourceRoot)) {
    emit({ state: "failed", error: `Missing resource root: ${resourceRoot ?? "(unset)"}` });
    process.exit(2);
  }

  const env = { ...managedEnv(), DEVHUB_PACKAGED_RUNTIME: "1" };

  emit({ state: "starting", service: "next" });
  /**
   * Next standalone insists on being run from its own directory: `server.js`
   * resolves `.next/` and `public/` relative to cwd, not to __dirname.
   */
  const next = track(
    fork(serverEntry, [], {
      cwd: serverDir,
      env: { ...env, PORT: String(port), HOSTNAME: host },
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    }),
    "next",
  );
  next.on("exit", (code) => {
    if (!stopping) {
      emit({ state: "failed", error: `Dashboard server exited (code ${code ?? "null"})` });
      void shutdown(1);
    }
  });

  /**
   * Peer services: OpenChamber (1336) and OpenCode (1338).
   *
   * Started here because the packaged app has no `concurrently` to do it. They
   * were missing from the first desktop builds entirely, which left the
   * Chamber and OpenCode pages permanently blank — the ports were simply never
   * listening.
   *
   * Deliberately not fatal. Both shell out to binaries the user may not have
   * installed, and "OpenCode is not installed" is a normal state for most
   * people, not a reason to refuse to start the dashboard.
   */
  const peersEntry = path.join(here, "start-peer-services.mjs");
  if (fs.existsSync(peersEntry)) {
    emit({ state: "starting", service: "peers" });
    const peers = track(
      spawn(process.execPath, [peersEntry], {
        cwd: serverDir,
        env,
        stdio: ["ignore", "inherit", "inherit"],
      }),
      "peers",
    );
    peers.on("exit", (code) => {
      if (!stopping && code !== 0) {
        log(`peer services exited (code ${code}) — OpenChamber/OpenCode unavailable`);
      }
    });
  } else {
    log(`no peer services staged at ${peersEntry}`);
  }

  const ptyEntry = path.join(here, "terminal-pty-server.cjs");
  if (fs.existsSync(ptyEntry)) {
    emit({ state: "starting", service: "terminal" });
    track(
      spawn(process.execPath, [ptyEntry], {
        cwd: serverDir,
        env: { ...env, TERMINAL_PORT: String(terminalPort) },
        stdio: ["ignore", "inherit", "inherit"],
      }),
      "terminal",
    );
  } else {
    log(`no terminal server staged at ${ptyEntry} — the terminal dock will not connect`);
  }

  try {
    await waitForPort(port, host, 60_000);
  } catch (err) {
    emit({ state: "failed", error: err.message });
    await shutdown(1);
    return;
  }

  emit({ state: "ready", url: `http://${host}:${port}`, port, terminalPort });
}

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void shutdown(0);
  });
}

/**
 * Orphan guard: if Rust dies without signalling us — a crash, a SIGKILL —
 * the stdin pipe closes and we take the children down with us. Without it the
 * sidecar and everything it started survive holding ports, and the next launch
 * finds 1337 occupied by a process nobody owns.
 *
 * Armed only when stdin really is a pipe. Launched any other way — `/dev/null`
 * from `nohup`, a terminal, a CI harness — stdin reports EOF immediately or
 * never, and an unconditional guard would shut the supervisor down about 200ms
 * after start. That made it impossible to run this file by hand to debug the
 * thing it exists to supervise.
 */
function stdinIsPipe() {
  try {
    return fs.fstatSync(0).isFIFO();
  } catch {
    return false;
  }
}

if (stdinIsPipe()) {
  process.stdin.on("end", () => {
    if (stopping) return;
    stopping = true;
    log("parent closed stdin — shutting down");
    void shutdown(0);
  });
  process.stdin.resume();
} else {
  log("stdin is not a pipe — orphan guard disabled (signals still work)");
}

main().catch(async (err) => {
  emit({ state: "failed", error: err instanceof Error ? err.message : String(err) });
  await shutdown(1);
});
