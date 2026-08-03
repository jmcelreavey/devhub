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
 * Strip packaged-desktop runtime vars from an env passed to git / hooks.
 *
 * The desktop sidecar sets DEVHUB_DESKTOP, redirects NOTES_DIR into app-data,
 * and forces NODE_ENV=production. Pre-push runs `npm run verify` which must look
 * like a normal checkout shell — otherwise hooks resolve the wrong roots and
 * Next builds can blow up with opaque "generate is not a function" failures.
 */
export function scrubDesktopRuntimeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean = { ...env };
  for (const key of Object.keys(clean)) {
    if (key === "DEVHUB_DESKTOP" || key.startsWith("DEVHUB_")) {
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
  }
  // Content dirs redirected into app-data — let checkout .env.local win instead.
  for (const key of ["NOTES_DIR", "TASKS_DIR", "COLLECTIONS_DIR", "UPSTARTS_DIR", "DOCS_DIR"]) {
    delete clean[key];
  }
  // Desktop sidecar forces NODE_ENV=production; hooks must not inherit it.
  if (clean.NODE_ENV === "production") {
    delete (clean as { NODE_ENV?: string }).NODE_ENV;
  }
  return clean;
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
