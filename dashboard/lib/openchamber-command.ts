import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { scrubNpmEnv } from "./process-env";

/** Env that makes OpenChamber attach to an existing OpenCode as an external server it cannot restart. */
export const OPENCODE_EXTERNAL_KEYS = [
  "OPENCODE_PORT",
  "OPENCODE_HOST",
  "OPENCODE_SKIP_START",
  "OPENCHAMBER_OPENCODE_PORT",
  "OPENCHAMBER_SKIP_OPENCODE_START",
  "OPENCHAMBER_INTERNAL_PORT",
] as const;

/** `KEY=value` for any of the keys above, as it appears in a `ps eww` dump. */
const EXTERNAL_OPENCODE_ENV = new RegExp(`(?:^|\\s)(?:${OPENCODE_EXTERNAL_KEYS.join("|")})=\\S`);

/**
 * True when a `ps eww` dump shows Chamber was started pinned to an external
 * OpenCode (skip-start or an explicit port). DevHub must replace that daemon
 * rather than reuse it — otherwise Rebuild/restart leaves Setup broken.
 */
export function chamberProcessPinsExternalOpenCode(psEwwOutput: string): boolean {
  return EXTERNAL_OPENCODE_ENV.test(psEwwOutput);
}

export function resolveOpenChamberPort(): number {
  const parsed = Number.parseInt(process.env.OPENCHAMBER_PORT ?? "1336", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1336;
}

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

  // Chamber Setup (Claude/Cursor) restarts OpenCode. If we pin OPENCODE_PORT
  // to DevHub's peer or set OPENCODE_SKIP_START, Chamber treats that process
  // as external and Setup fails with "The provider could not be opened yet".
  for (const key of OPENCODE_EXTERNAL_KEYS) delete env[key];

  const userOpencode = path.join(process.env.HOME ?? "", ".opencode", "bin", "opencode");
  if (!process.env.DEVHUB_OPENCODE_BINARY && fs.existsSync(userOpencode)) {
    env.OPENCODE_BINARY = userOpencode;
  } else if (process.env.DEVHUB_OPENCODE_BINARY) {
    env.OPENCODE_BINARY = process.env.DEVHUB_OPENCODE_BINARY;
  }

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
 * Several copies can coexist (nvm per node version, Homebrew, a leftover
 * global). Taking the first hit — PATH, then the node sibling, then a login
 * shell, then the newest *node* that happens to have a bin — will happily
 * launch a stale 1.11.3 from an old nvm prefix while the user-facing app is
 * already on 1.19.0. Collect every candidate and pick the highest
 * `@openchamber/web` package version. `OPENCHAMBER_BIN` still wins outright.
 *
 * The result is cached for the process lifetime; `ensureOpenChamberCurrent`
 * clears the cache after `openchamber update` in case the install moved.
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

function whichAllOnPath(cmd: string): string[] {
  const which = process.platform === "win32" ? "where" : "which";
  const args = process.platform === "win32" ? [cmd] : ["-a", cmd];
  const res = spawnSync(which, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (res.status === 0 && res.stdout) {
    const all = res.stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && fs.existsSync(s));
    if (all.length > 0) return all;
  }
  const single = whichOnPath(cmd);
  return single ? [single] : [];
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

function listNvmOpenChamberBins(binName: string): string[] {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) return [];

  const versionsDir = path.join(home, ".nvm", "versions", "node");
  if (!fs.existsSync(versionsDir)) return [];

  const found: string[] = [];
  for (const entry of fs.readdirSync(versionsDir)) {
    const candidate = path.join(versionsDir, entry, "bin", binName);
    if (fs.existsSync(candidate)) found.push(candidate);
  }
  return found;
}

function wellKnownOpenChamberBins(binName: string): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return [
    path.join("/opt/homebrew/bin", binName),
    path.join("/usr/local/bin", binName),
    path.join(home, ".local", "bin", binName),
  ].filter((candidate) => fs.existsSync(candidate));
}

function readPackageVersion(pkgPath: string): string | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const version = (parsed as { version?: unknown }).version;
    return typeof version === "string" && version.trim() ? version.trim() : null;
  } catch {
    return null;
  }
}

/** Package version next to an `openchamber` bin or `server/index.js` entry. */
export function openChamberInstallVersion(binOrEntry: string): string | null {
  let real = binOrEntry;
  try {
    real = fs.realpathSync(binOrEntry);
  } catch {
    /* use the given path */
  }
  for (const pkgPath of [
    path.join(path.dirname(real), "..", "package.json"),
    path.join(path.dirname(real), "package.json"),
  ]) {
    const version = readPackageVersion(pkgPath);
    if (version) return version;
  }
  return null;
}

export function compareInstallVersions(a: string, b: string): number {
  const parse = (value: string): number[] =>
    value.replace(/^v/i, "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(3, pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const delta = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

export function selectNewestOpenChamberBin(candidates: string[]): string | null {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const bin of candidates) {
    if (!bin || !fs.existsSync(bin)) continue;
    let key = bin;
    try {
      key = fs.realpathSync(bin);
    } catch {
      /* compare the unresolved path */
    }
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(bin);
  }
  if (unique.length === 0) return null;

  let best = unique[0];
  let bestVer = openChamberInstallVersion(best) ?? "0.0.0";
  for (const candidate of unique.slice(1)) {
    const version = openChamberInstallVersion(candidate) ?? "0.0.0";
    if (compareInstallVersions(version, bestVer) > 0) {
      best = candidate;
      bestVer = version;
    }
  }
  return best;
}

function collectOpenChamberBins(binName: string): string[] {
  const sibling = path.join(path.dirname(process.execPath), binName);
  const login = whichViaLoginShell("openchamber");
  return [
    ...whichAllOnPath("openchamber"),
    ...(fs.existsSync(sibling) ? [sibling] : []),
    ...(login ? [login] : []),
    ...listNvmOpenChamberBins(binName),
    ...wellKnownOpenChamberBins(binName),
  ];
}

export function findOpenChamberBin(): string | null {
  const configured = process.env.OPENCHAMBER_BIN?.trim();
  if (configured) return fs.existsSync(configured) ? configured : null;

  if (cachedOpenChamberBin !== undefined) return cachedOpenChamberBin;

  const binName = process.platform === "win32" ? "openchamber.cmd" : "openchamber";
  cachedOpenChamberBin = selectNewestOpenChamberBin(collectOpenChamberBins(binName));
  return cachedOpenChamberBin;
}

function resetOpenChamberBinCache(): void {
  cachedOpenChamberBin = undefined;
}

/** Best-effort update for the system-managed OpenChamber install. */
export function ensureOpenChamberCurrent(log: (msg: string) => void): void {
  if (process.env.DEVHUB_SKIP_OPENCHAMBER_UPDATE) {
    log("OpenChamber auto-update skipped (DEVHUB_SKIP_OPENCHAMBER_UPDATE)");
    return;
  }

  const binary = findOpenChamberBin();
  if (!binary) {
    log("OpenChamber update check skipped (binary not installed)");
    return;
  }

  const before = openChamberInstallVersion(binary);
  log(`checking OpenChamber${before ? ` ${before}` : ""} for updates…`);
  const res = spawnSync(binary, ["update"], {
    stdio: "inherit",
    env: cleanOpenChamberEnv(),
    timeout: 120_000,
  });
  if (res.error) {
    log(`OpenChamber update check skipped (${res.error.message}); using existing binary`);
    return;
  }
  if (res.status !== 0) {
    log(`OpenChamber update failed (exit ${res.status ?? "signal"}); keeping existing binary`);
  }

  // `update` may write a different prefix than the one we invoked (nvm vs brew).
  resetOpenChamberBinCache();
  const latest = findOpenChamberBin();
  const after = latest ? openChamberInstallVersion(latest) : null;
  if (latest && latest !== binary) {
    log(`OpenChamber install is now ${latest}${after ? ` (${after})` : ""}`);
  }
}

/**
 * True when the process on Chamber's port is an older (or different) install
 * than the binary DevHub is about to launch. Same version on another path is
 * left alone — that's a current user-started daemon.
 */
export function shouldReplaceOpenChamberListener(opts: {
  cmdline: string;
  currentBin: string;
  currentEntry: string | null;
  currentVersion: string | null;
  entryMtimeMs?: number;
  processAgeSeconds?: number | null;
}): boolean {
  const currentPaths = [opts.currentBin, opts.currentEntry].filter((p): p is string => Boolean(p));
  const mentionsCurrent = currentPaths.some((p) => opts.cmdline.includes(p));
  const runningVersion = inferOpenChamberVersionFromCmdline(opts.cmdline);

  if (opts.currentVersion && runningVersion && compareInstallVersions(runningVersion, opts.currentVersion) < 0) {
    return true;
  }

  if (!mentionsCurrent && /openchamber|@openchamber\/web/i.test(opts.cmdline)) {
    if (!runningVersion || !opts.currentVersion) return true;
    return compareInstallVersions(runningVersion, opts.currentVersion) < 0;
  }

  if (mentionsCurrent && opts.entryMtimeMs != null && opts.processAgeSeconds != null) {
    const processStartMs = Date.now() - opts.processAgeSeconds * 1000;
    if (opts.entryMtimeMs > processStartMs + 2_000) return true;
  }

  return false;
}

function inferOpenChamberVersionFromCmdline(cmdline: string): string | null {
  const match = cmdline.match(/(\/\S+\/(?:server\/index\.js|bin\/cli\.js))/);
  if (!match) return null;
  return openChamberInstallVersion(match[1]);
}

/**
 * Find the daemon entrypoint that `openchamber serve` would spawn.
 *
 * `serve` is a wrapper: it spawns `server/index.js` under Bun, then waits for a
 * ready signal. On this machine that signal never arrives and `serve` fails with
 * "OpenChamber daemon did not report ready within 30s" — while running
 * `bun server/index.js` directly starts cleanly, binds its port, and serves.
 *
 * So we skip the wrapper. Its only job is spawn-and-wait, and DevHub already
 * polls the health endpoint itself, so nothing is lost by doing the spawn
 * directly and everything is gained by not depending on a handshake that is
 * observably broken.
 */
export function findOpenChamberServerEntry(bin: string): string | null {
  let real = bin;
  try {
    real = fs.realpathSync(bin);
  } catch {
    /* use the bin path as-is */
  }
  // .../@openchamber/web/bin/cli.js → .../@openchamber/web/server/index.js
  const packageRoot = path.resolve(path.dirname(real), "..");
  const entry = path.join(packageRoot, "server", "index.js");
  return fs.existsSync(entry) ? entry : null;
}

/** Bun, which the OpenChamber daemon requires. Node cannot run it. */
function findBun(): string | null {
  for (const candidate of [
    "/opt/homebrew/bin/bun",
    "/usr/local/bin/bun",
    path.join(process.env.HOME ?? "", ".bun", "bin", "bun"),
  ]) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  const res = spawnSync("/usr/bin/which", ["bun"], { encoding: "utf8" });
  const found = res.stdout?.trim();
  return found && fs.existsSync(found) ? found : null;
}

/**
 * Resolve how to invoke OpenChamber.
 *
 * Preference order:
 *
 * 1. **The daemon directly, under Bun.** Bypasses the broken `serve` handshake
 *    described above. This is what actually works.
 * 2. The CLI `.js` under DevHub's own node — the previous behaviour, kept as a
 *    fallback for installs where the server entry has moved or Bun is absent,
 *    so a layout change upstream degrades rather than breaks.
 * 3. The bare binary.
 */
export function resolveOpenChamberCommand(): {
  cmd: string;
  argsPrefix: string[];
  source: string;
  /** True when we spawn the long-lived daemon ourselves instead of `serve`. */
  bypassesServe?: boolean;
} {
  const bin = findOpenChamberBin();
  if (!bin) return { cmd: "openchamber", argsPrefix: [], source: "PATH lookup" };

  const version = openChamberInstallVersion(bin);
  const versionNote = version ? ` ${version}` : "";
  const entry = findOpenChamberServerEntry(bin);
  const bun = findBun();
  if (entry && bun) {
    return {
      cmd: bun,
      argsPrefix: [entry],
      source: `bun server/index.js${versionNote} (bypassing serve)`,
      bypassesServe: true,
    };
  }

  let real = bin;
  try {
    real = fs.realpathSync(bin);
  } catch {
    // Use the bin path as-is if the symlink can't be resolved.
  }
  if (real.endsWith(".js")) {
    return { cmd: process.execPath, argsPrefix: [real], source: `node ${path.basename(real)}${versionNote}` };
  }
  return { cmd: bin, argsPrefix: [], source: `system openchamber${versionNote}` };
}
