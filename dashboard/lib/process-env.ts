/**
 * Standard locations where CLIs (gh, aws, bike, etc.) are installed.
 * Shared across bi-ops, gh-exec, health-check, standup-doctor, etc.
 *
 * /opt/homebrew/bin  — Apple Silicon Homebrew
 * /usr/local/bin     — Intel Homebrew, standard Linux
 * /opt/local/bin     — MacPorts
 * ~/.local/bin       — Linux user installs (pip --user, cargo, etc.)
 * ~/Library/Python   — macOS pip --user console scripts
 */
import path from "node:path";

const SYSTEM_PATH_SEGMENTS = ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"];

export function extraPathSegments(home?: string, executablePath = process.execPath): string[] {
  return [
    path.dirname(executablePath),
    ...SYSTEM_PATH_SEGMENTS,
    ...(home
      ? [
          path.join(home, ".opencode", "bin"),
          path.join(home, ".npm", "bin"),
          path.join(home, ".local", "bin"),
          ...["3.9", "3.10", "3.11", "3.12", "3.13"].map((version) =>
            path.join(home, "Library", "Python", version, "bin"),
          ),
        ]
      : []),
  ];
}

/** Current-process compatibility export; prefer extraPathSegments(env.HOME) for spawned environments. */
export const EXTRA_PATH_SEGMENTS = extraPathSegments(process.env.HOME);

const NPM_LIFECYCLE_KEYS = [
  "INIT_CWD",
  "npm_command",
  "npm_execpath",
  "npm_lifecycle_event",
  "npm_lifecycle_script",
  "npm_node_execpath",
  "npm_package_json",
  "npm_package_name",
  "npm_package_version",
];

export function scrubNpmEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const clean = { ...env };
  for (const key of Object.keys(clean)) {
    if (key.startsWith("npm_config_") || key.startsWith("npm_package_")) {
      delete clean[key];
    }
  }
  for (const key of NPM_LIFECYCLE_KEYS) {
    delete clean[key];
  }
  return clean;
}


/**
 * Strip packaged-desktop runtime vars from an env passed to child processes.
 *
 * The desktop sidecar sets DEVHUB_DESKTOP, redirects NOTES_DIR into app-data,
 * and forces NODE_ENV=production. The packaged Next standalone server also
 * stashes `__NEXT_PRIVATE_STANDALONE_CONFIG` on process.env (JSON — no
 * functions). Git hooks and terminal shells must look like a normal checkout
 * shell instead of inheriting DevHub's private runtime, or `next build` dies
 * with `TypeError: generate is not a function`.
 */
export function scrubDesktopRuntimeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean = { ...env };
  for (const key of Object.keys(clean)) {
    if (!key.startsWith("DEVHUB_")) continue;
    // Keep credential / op helpers that hooks may need; drop runtime layout.
    if (
      key.startsWith("DEVHUB_OP_") ||
      key === "DEVHUB_REPOS_DIR" ||
      key === "DEVHUB_ALLOWED_DEV_ORIGINS"
    ) {
      continue;
    }
    delete clean[key];
  }
  // Content dirs redirected into app-data — let checkout .env.local win instead.
  for (const key of ["NOTES_DIR", "TASKS_DIR", "COLLECTIONS_DIR", "UPSTARTS_DIR", "DOCS_DIR"]) {
    delete clean[key];
  }
  // Desktop sidecar forces NODE_ENV=production; hooks must not inherit it.
  if (clean.NODE_ENV === "production") {
    delete (clean as { NODE_ENV?: string }).NODE_ENV;
  }
  delete clean.PORT;
  // Next standalone server.js does:
  //   process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig)
  // JSON drops functions, so a leaked copy makes `next build` in pre-push blow up
  // with `TypeError: generate is not a function` (generateBuildId is missing).
  for (const key of Object.keys(clean)) {
    if (key.startsWith("__NEXT_PRIVATE_")) delete clean[key];
  }
  return clean;
}

/**
 * The environment an interactive terminal shell starts with.
 *
 * Starts from the desktop-scrubbed env, then drops every npm config variable
 * in either case. DevHub's packaged runtime sets `NPM_CONFIG_PREFIX` so ITS
 * installs land outside the immutable payload; passed on to a user's shell it
 * makes nvm refuse to load ("nvm is not compatible with the NPM_CONFIG_PREFIX
 * environment variable") and sends their `npm -g` into DevHub's tools folder.
 *
 * `demoteFromPath` directories (the bundled Node, DevHub's tools/bin) stay
 * available but go last, so they cannot shadow the user's own node or CLIs.
 */
export function terminalShellEnv(
  source: NodeJS.ProcessEnv,
  demoteFromPath: readonly string[] = packagedToolDirs(source, source.HOME ?? ""),
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(scrubDesktopRuntimeEnv(source))) {
    if (value === undefined) continue;
    if (key.toLowerCase().startsWith("npm_") || key.startsWith("NEXT_") || key === "NODE_OPTIONS") continue;
    env[key] = value;
  }
  if (env.PATH && demoteFromPath.length > 0) {
    const privateNpmDirs = new Set(demoteFromPath.map((dir) => path.join(dir, "npm-bin")));
    const segments = env.PATH.split(path.delimiter).filter((segment) => segment && !privateNpmDirs.has(segment));
    const demoted = new Set(demoteFromPath);
    env.PATH = [
      ...segments.filter((segment) => !demoted.has(segment)),
      ...segments.filter((segment) => demoted.has(segment)),
    ].join(path.delimiter);
  }
  return env;
}

/** Directories of DevHub's own tooling that a packaged runtime puts on PATH. */
export function packagedToolDirs(
  source: NodeJS.ProcessEnv,
  home: string,
  executablePath = process.execPath,
): string[] {
  if (source.DEVHUB_PACKAGED_RUNTIME !== "1") return [];
  return [
    path.dirname(executablePath),
    path.join(home, ".local", "share", "devhub", "tools", "bin"),
    ...(source.DEVHUB_MANAGED_NODE_BIN ? [source.DEVHUB_MANAGED_NODE_BIN] : []),
    ...(source.DEVHUB_BASE_PAYLOAD_DIR ? [path.join(source.DEVHUB_BASE_PAYLOAD_DIR, "runtime")] : []),
  ];
}

export function augmentedPathEnv(extra: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  const base = { ...scrubNpmEnv(), ...extra };
  const existing = base.PATH ?? "";
  const segments = existing.split(path.delimiter).filter(Boolean);
  const missing = extraPathSegments(base.HOME).filter((segment) => !segments.includes(segment));

  return {
    ...base,
    PATH: [...segments, ...missing].join(path.delimiter),
  };
}
