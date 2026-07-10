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
