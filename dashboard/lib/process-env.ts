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
export const EXTRA_PATH_SEGMENTS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/opt/local/bin",
  `${process.env.HOME ?? ""}/.local/bin`,
  ...["3.9", "3.10", "3.11", "3.12", "3.13"].map((version) =>
    `${process.env.HOME ?? ""}/Library/Python/${version}/bin`,
  ),
].filter(Boolean);

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
  const base = scrubNpmEnv();
  const existing = base.PATH ?? "";
  const segments = existing.split(":").filter(Boolean);
  const missing = EXTRA_PATH_SEGMENTS.filter((seg) => !segments.includes(seg));

  return {
    ...base,
    PATH: missing.length ? [...segments, ...missing].join(":") : existing,
    ...extra,
  };
}
