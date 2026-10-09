/**
 * On macOS, `/usr/bin/git` without the Command Line Tools is Apple's shim.
 * Running it opens the system "Install Command Line Developer Tools" dialog.
 * Every availability probe goes through here and does not run that shim
 * unless a developer directory is already present.
 *
 * A non-shim git (Homebrew's `/opt/homebrew/bin/git`, for example) counts as
 * available even when the Command Line Tools are missing.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { extraPathSegments } from "@/lib/process-env";

export { GIT_MISSING_PLUGIN_MESSAGE, MAC_GIT_INSTALL_FOLLOWUP } from "@/lib/setup/git-copy";

const APPLE_GIT_SHIM = "/usr/bin/git";
const DEVELOPER_DIRS = [
  "/Library/Developer/CommandLineTools",
  "/Applications/Xcode.app/Contents/Developer",
];
const CACHE_MS = 15_000;

export interface GitAvailability {
  /** Safe to execute. False when git is absent or the only git is the CLT shim. */
  runnable: boolean;
  /** Absolute path of the git that should be executed, when there is one. */
  bin: string | null;
  /** The only git on the search path is Apple's shim and no developer dir exists. */
  cltShim: boolean;
}

export interface XcodeSelectResult {
  ok: boolean;
  dir: string | null;
}

export interface GitAvailabilityOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /**
   * Add standard install locations (Homebrew, `~/.local/bin`) to PATH.
   * Probes do this so a GUI-launched app still sees Homebrew git. A caller
   * that already passed a closed PATH (a test, a restricted child) leaves it off.
   */
  augment?: boolean;
  fresh?: boolean;
  exists?: (file: string) => boolean;
  /** True when a developer directory exists. Directories are not git binaries. */
  dirExists?: (file: string) => boolean;
  realpath?: (file: string) => string;
  executable?: (file: string) => boolean;
  now?: () => number;
}

interface ResolvedOptions {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  augment: boolean;
  exists: (file: string) => boolean;
  dirExists: (file: string) => boolean;
  realpath: (file: string) => string;
  executable: (file: string) => boolean;
  now: () => number;
}

let cache: { key: string; at: number; value: GitAvailability } | null = null;

export function clearGitAvailabilityCache(): void {
  cache = null;
}

export function isAppleGitShim(bin: string, realpath: (file: string) => string = defaultRealpath): boolean {
  if (normalize(bin) === APPLE_GIT_SHIM) return true;
  try {
    return normalize(realpath(bin)) === APPLE_GIT_SHIM;
  } catch {
    return false;
  }
}

function normalize(file: string): string {
  const resolved = path.normalize(file);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function defaultExists(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function defaultDirExists(file: string): boolean {
  try {
    return fs.statSync(file).isDirectory();
  } catch {
    return false;
  }
}

function defaultRealpath(file: string): string {
  try {
    return fs.realpathSync(file);
  } catch {
    return file;
  }
}

function defaultExecutable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function gitSearchPath(env: NodeJS.ProcessEnv, augment: boolean): string {
  const current = env.PATH ?? "";
  if (!augment) return current;
  const home = env.HOME || env.USERPROFILE || "";
  const extra = [
    ...extraPathSegments(home || undefined),
    home ? path.join(home, "bin") : "",
    "/usr/bin",
    "/bin",
  ].filter(Boolean);
  const seen = new Set(current.split(path.delimiter).filter(Boolean));
  const additions = extra.filter((dir) => !seen.has(dir));
  return [current, ...additions].filter(Boolean).join(path.delimiter);
}

function resolveOptions(opts: GitAvailabilityOptions | undefined): ResolvedOptions {
  return {
    env: opts?.env ?? process.env,
    platform: opts?.platform ?? process.platform,
    augment: opts?.augment ?? true,
    exists: opts?.exists ?? defaultExists,
    dirExists: opts?.dirExists ?? defaultDirExists,
    realpath: opts?.realpath ?? defaultRealpath,
    executable: opts?.executable ?? defaultExecutable,
    now: opts?.now ?? Date.now,
  };
}

function gitNames(platform: NodeJS.Platform): string[] {
  return platform === "win32" ? ["git.exe", "git.cmd", "git"] : ["git"];
}

/** First real git on PATH, otherwise Apple's shim if that is the only one. */
export function locateGit(opts: ResolvedOptions): { nonShim: string | null; shim: string | null } {
  const search = gitSearchPath(opts.env, opts.augment);
  let shim: string | null = null;
  for (const dir of search.split(path.delimiter).filter(Boolean)) {
    for (const name of gitNames(opts.platform)) {
      const candidate = path.join(dir, name);
      if (!opts.exists(candidate) || !opts.executable(candidate)) continue;
      if (opts.platform === "darwin" && isAppleGitShim(candidate, opts.realpath)) {
        shim ??= candidate;
        continue;
      }
      return { nonShim: candidate, shim: null };
    }
  }
  return { nonShim: null, shim };
}

function developerDirOnDisk(dirExists: (file: string) => boolean): string | null {
  for (const dir of DEVELOPER_DIRS) {
    if (dirExists(dir)) return dir;
  }
  return null;
}

function decide(
  located: { nonShim: string | null; shim: string | null },
  platform: NodeJS.Platform,
  developerDir: string | null,
): GitAvailability {
  if (located.nonShim) return { runnable: true, bin: located.nonShim, cltShim: false };
  if (!located.shim) return { runnable: false, bin: null, cltShim: false };
  if (platform !== "darwin") return { runnable: true, bin: located.shim, cltShim: false };
  if (developerDir) return { runnable: true, bin: located.shim, cltShim: false };
  return { runnable: false, bin: located.shim, cltShim: true };
}

function cacheKey(opts: ResolvedOptions): string {
  return `${opts.platform}\0${opts.augment ? "1" : "0"}\0${gitSearchPath(opts.env, opts.augment)}`;
}

function remember(key: string, now: number, value: GitAvailability): GitAvailability {
  cache = { key, at: now, value };
  return value;
}

function cachedValue(opts: ResolvedOptions, fresh: boolean | undefined): GitAvailability | null {
  if (fresh) return null;
  const key = cacheKey(opts);
  if (!cache || cache.key !== key) return null;
  if (opts.now() - cache.at > CACHE_MS) return null;
  return cache.value;
}

async function defaultXcodeSelect(): Promise<XcodeSelectResult> {
  const { execExternal } = await import("@/lib/exec-external");
  try {
    const result = await execExternal("xcode-select", ["-p"], {
      timeoutMs: 4_000,
      label: "xcode-select:-p",
    });
    const dir = result.stdout.trim();
    return { ok: dir.length > 0, dir: dir || null };
  } catch {
    return { ok: false, dir: null };
  }
}

function defaultXcodeSelectSync(): XcodeSelectResult {
  try {
    const out = execFileSync("xcode-select", ["-p"], {
      encoding: "utf8",
      timeout: 4_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const dir = out.trim();
    return { ok: dir.length > 0, dir: dir || null };
  } catch {
    return { ok: false, dir: null };
  }
}

function developerDirAfterSelect(
  dirExists: (file: string) => boolean,
  selected: XcodeSelectResult,
): string | null {
  const onDisk = developerDirOnDisk(dirExists);
  if (onDisk) return onDisk;
  if (selected.ok && selected.dir && dirExists(selected.dir)) return selected.dir;
  return null;
}

/**
 * Report whether git can be run. Does not run git. On darwin, runs
 * `xcode-select -p` only when the git that would be used is Apple's shim
 * and no developer directory is already on disk.
 */
export async function assessGitAvailability(
  opts?: GitAvailabilityOptions & { xcodeSelect?: () => Promise<XcodeSelectResult> },
): Promise<GitAvailability> {
  const resolved = resolveOptions(opts);
  const hit = cachedValue(resolved, opts?.fresh);
  if (hit) return hit;
  const located = locateGit(resolved);
  const key = cacheKey(resolved);
  if (located.nonShim || !located.shim || resolved.platform !== "darwin") {
    return remember(key, resolved.now(), decide(located, resolved.platform, null));
  }
  if (developerDirOnDisk(resolved.dirExists)) {
    return remember(key, resolved.now(), decide(located, resolved.platform, DEVELOPER_DIRS[0]));
  }
  const selected = await (opts?.xcodeSelect ?? defaultXcodeSelect)();
  const dir = developerDirAfterSelect(resolved.dirExists, selected);
  return remember(key, resolved.now(), decide(located, resolved.platform, dir));
}

/** Synchronous probe for page-load checks. Same decision, `xcode-select -p` via execFile. */
export function assessGitAvailabilitySync(
  opts?: GitAvailabilityOptions & { xcodeSelect?: () => XcodeSelectResult },
): GitAvailability {
  const resolved = resolveOptions(opts);
  const hit = cachedValue(resolved, opts?.fresh);
  if (hit) return hit;
  const located = locateGit(resolved);
  const key = cacheKey(resolved);
  if (located.nonShim || !located.shim || resolved.platform !== "darwin") {
    return remember(key, resolved.now(), decide(located, resolved.platform, null));
  }
  if (developerDirOnDisk(resolved.dirExists)) {
    return remember(key, resolved.now(), decide(located, resolved.platform, DEVELOPER_DIRS[0]));
  }
  const selected = opts?.xcodeSelect ? opts.xcodeSelect() : defaultXcodeSelectSync();
  const dir = developerDirAfterSelect(resolved.dirExists, selected);
  return remember(key, resolved.now(), decide(located, resolved.platform, dir));
}

/** `git --version` exit 0, after the shim check. Never runs the shim when the CLT is missing. */
export async function gitVersionAvailable(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const gate = await assessGitAvailability({ env, augment: true });
  if (!gate.runnable || !gate.bin) return false;
  const { execExternal } = await import("@/lib/exec-external");
  try {
    await execExternal(gate.bin, ["--version"], { env, timeoutMs: 4_000, label: "git:--version" });
    return true;
  } catch {
    return false;
  }
}

/** `gh --version` exit 0. File existence is not enough: a stub can sit on PATH. */
export async function ghVersionAvailable(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const { execExternal } = await import("@/lib/exec-external");
  try {
    await execExternal("gh", ["--version"], { env, timeoutMs: 4_000, label: "gh:--version" });
    return true;
  } catch {
    return false;
  }
}
