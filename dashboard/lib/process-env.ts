/**
 * Standard locations where CLIs (gh, aws, bike, etc.) are installed.
 * Shared across bi-ops, gh-exec, health-check, standup-doctor, etc.
 *
 * /opt/homebrew/bin  — Apple Silicon Homebrew
 * /usr/local/bin     — Intel Homebrew, standard Linux
 * /opt/local/bin     — MacPorts
 * ~/.local/bin       — Linux user installs (pip --user, cargo, etc.)
 */
export const EXTRA_PATH_SEGMENTS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/opt/local/bin",
  `${process.env.HOME ?? ""}/.local/bin`,
].filter(Boolean);

export function augmentedPathEnv(extra: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  const existing = process.env.PATH ?? "";
  const segments = existing.split(":").filter(Boolean);
  const missing = EXTRA_PATH_SEGMENTS.filter((seg) => !segments.includes(seg));

  return {
    ...process.env,
    PATH: missing.length ? [...segments, ...missing].join(":") : existing,
    ...extra,
  };
}
