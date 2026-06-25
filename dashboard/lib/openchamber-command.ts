import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolveOpenCodePort } from "./opencode-command";
import { scrubNpmEnv } from "./process-env";

export function cleanOpenChamberEnv(): NodeJS.ProcessEnv {
  const env = scrubNpmEnv();

  // Strip env vars injected by the OpenChamber desktop app — they point the
  // CLI daemon at the app bundle's static files and runtime config, which
  // can crash or mislead the headless daemon DevHub spawns.
  const DESKTOP_LEAK_KEYS = [
    "OPENCHAMBER_DIST_DIR",
    "OPENCHAMBER_RUNTIME",
    "OPENCHAMBER_DESKTOP_NOTIFY",
    "OPENCHAMBER_SKIP_API_COMPRESSION",
    "__CFBundleIdentifier",
  ];
  for (const key of DESKTOP_LEAK_KEYS) delete env[key];

  const userOpencode = path.join(process.env.HOME ?? "", ".opencode", "bin", "opencode");
  if (!process.env.DEVHUB_OPENCODE_BINARY && fs.existsSync(userOpencode)) {
    env.OPENCODE_BINARY = userOpencode;
  } else if (process.env.DEVHUB_OPENCODE_BINARY) {
    env.OPENCODE_BINARY = process.env.DEVHUB_OPENCODE_BINARY;
  }

  // Use DevHub's shared opencode serve (start-opencode.ts) instead of embedding another.
  env.OPENCODE_PORT = String(resolveOpenCodePort());
  env.OPENCODE_SKIP_START = "true";
  // OPENCODE_HOST is a full URL in OpenChamber; DevHub bind address lives in OPENCODE_BIND_HOST.
  delete env.OPENCODE_HOST;

  return env;
}

export interface OpenChamberBind {
  /** Address passed to `openchamber serve --host`. */
  host: string;
  /** Loopback-safe address used to probe the daemon for liveness. */
  probe: string;
  /** Set when we had to downgrade the requested host; worth logging once. */
  note?: string;
}

function isTruthyFlag(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}

/**
 * Resolve the bind host for the OpenChamber daemon.
 *
 * OpenChamber ≥1.13 refuses to bind a non-loopback (LAN) address unless UI
 * auth is configured — it exits with code 4 and DevHub silently starts without
 * Chamber. Preserve LAN exposure when the user has opted in (a UI password, or
 * an explicit unauthenticated-LAN override); otherwise fall back to loopback so
 * the daemon still comes up out of the box.
 */
export function resolveOpenChamberBind(
  env: Record<string, string | undefined> = process.env,
): OpenChamberBind {
  const requested = env.OPENCHAMBER_HOST?.trim() || "0.0.0.0";
  const hasUiPassword = (env.OPENCHAMBER_UI_PASSWORD?.trim()?.length ?? 0) > 0;
  const allowUnauthLan = isTruthyFlag(env.OPENCHAMBER_ALLOW_UNAUTHENTICATED_LAN);
  const isLoopback =
    requested === "127.0.0.1" || requested === "localhost" || requested === "::1";

  let host = requested;
  let note: string | undefined;
  if (!isLoopback && !hasUiPassword && !allowUnauthLan) {
    host = "127.0.0.1";
    note =
      `OpenChamber refuses to bind ${requested} without UI auth — falling back to 127.0.0.1 (local only). ` +
      `Set OPENCHAMBER_UI_PASSWORD (recommended) or OPENCHAMBER_ALLOW_UNAUTHENTICATED_LAN=true to expose it over the LAN.`;
  }

  const probe = host === "0.0.0.0" ? "127.0.0.1" : host;
  return { host, probe, note };
}

/**
 * Locate the `openchamber` executable, independent of the server process's PATH.
 *
 * DevHub no longer vendors @openchamber/web — the developer manages their own
 * OpenChamber. The catch: when DevHub is launched from the GUI (or any context
 * that doesn't source the user's login shell), `process.env.PATH` often omits
 * the dir the install lives in — e.g. an nvm bin dir for a global npm install —
 * so a bare `which openchamber` finds nothing even though it's installed.
 *
 * We try, in order: an explicit `OPENCHAMBER_BIN`; the current PATH; the bin dir
 * beside the running node (where nvm/global installs land); a login shell,
 * which sees the user's real PATH; and finally other nvm node versions, because
 * GUI restarts can run DevHub under a different node than the one that owns the
 * global OpenChamber install. The result is cached for the process lifetime —
 * install a new copy and restart DevHub to pick it up.
 */
let cachedOpenChamberBin: string | null | undefined;

function whichOnPath(cmd: string, env?: NodeJS.ProcessEnv): string | null {
  const which = process.platform === "win32" ? "where" : "which";
  const res = spawnSync(which, [cmd], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env,
  });
  if (res.status !== 0) return null;
  const first = res.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
  return first && fs.existsSync(first) ? first : null;
}

function whichViaLoginShell(cmd: string): string | null {
  if (process.platform === "win32") return null;
  const shell = process.env.SHELL || "/bin/zsh";
  try {
    const res = spawnSync(shell, ["-lic", `command -v ${cmd}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    });
    if (res.status !== 0) return null;
    const last = res.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).pop();
    return last && fs.existsSync(last) ? last : null;
  } catch {
    return null;
  }
}

function findInNvmVersions(binName: string): string | null {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) return null;

  const versionsDir = path.join(home, ".nvm", "versions", "node");
  if (!fs.existsSync(versionsDir)) return null;

  for (const entry of fs.readdirSync(versionsDir)) {
    const candidate = path.join(versionsDir, entry, "bin", binName);
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

export function findOpenChamberBin(): string | null {
  const configured = process.env.OPENCHAMBER_BIN?.trim();
  if (configured) return fs.existsSync(configured) ? configured : null;

  if (cachedOpenChamberBin !== undefined) return cachedOpenChamberBin;

  const binName = process.platform === "win32" ? "openchamber.cmd" : "openchamber";

  // 1) Current PATH — fast, and correct when DevHub is started from a terminal.
  let found = whichOnPath("openchamber");

  // 2) Beside the running node — nvm/global npm installs put the bin here.
  if (!found) {
    const sibling = path.join(path.dirname(process.execPath), binName);
    if (fs.existsSync(sibling)) found = sibling;
  }

  // 3) Login shell — sees the user's real PATH under a GUI launch.
  if (!found) found = whichViaLoginShell("openchamber");

  // 4) Other nvm versions — OpenChamber may be installed under a different node.
  if (!found) found = findInNvmVersions(binName);

  cachedOpenChamberBin = found ?? null;
  return cachedOpenChamberBin;
}

/** Resolve how to invoke OpenChamber. Runs the CLI `.js` with DevHub's own node
 * so it never depends on a `node` being on PATH for the shebang. */
export function resolveOpenChamberCommand(): { cmd: string; argsPrefix: string[]; source: string } {
  const bin = findOpenChamberBin();
  if (!bin) return { cmd: "openchamber", argsPrefix: [], source: "PATH lookup" };

  let real = bin;
  try {
    real = fs.realpathSync(bin);
  } catch {
    // Use the bin path as-is if the symlink can't be resolved.
  }
  if (real.endsWith(".js")) {
    return { cmd: process.execPath, argsPrefix: [real], source: `node ${path.basename(real)}` };
  }
  return { cmd: bin, argsPrefix: [], source: "system openchamber" };
}
