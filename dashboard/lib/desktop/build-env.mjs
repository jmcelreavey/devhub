import fs from "node:fs";
import path from "node:path";

/**
 * Environment for a checkout rebuild's install and build children.
 *
 * The dashboard that launches the rebuild is `next start` (NODE_ENV=production,
 * npm_* from that lifecycle, and Next's private standalone config). An install
 * that inherits those prunes devDependencies, and a build that inherits
 * `__NEXT_PRIVATE_STANDALONE_CONFIG` dies inside generateBuildId. One scrub is
 * used by the script and by the process that spawns it.
 */

/** Server and toolchain variables that must not leak into npm or `next build`. */
const DROP_EXACT = new Set([
  "NODE_ENV",
  "NEXT_RUNTIME",
  "PORT",
  "HOSTNAME",
  "TERMINAL_PORT",
  "DEVHUB_PORT",
  "DEVHUB_TERMINAL_PORT",
  "DEVHUB_MCP_HTTP_PORT",
  "DEVHUB_PASEO_PORT",
]);

/**
 * Copy `env` without the variables a running DevHub server would leak.
 * `next build` sets NODE_ENV=production itself; leaving it unset is what lets
 * `npm install` keep devDependencies.
 */
export function cleanBuildEnv(env) {
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string") continue;
    if (DROP_EXACT.has(key)) continue;
    if (key.startsWith("__NEXT_")) continue;
    if (/^npm_/i.test(key)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Where npm-cli.js lives for a Node install.
 *
 * Official layout: `<prefix>/bin/node` and `<prefix>/lib/node_modules/npm`.
 * The Windows payload copies that Node to `<runtime>/node` and ships npm at
 * `<runtime>/lib/node_modules/npm`, so the same lookup works when the binary
 * is not inside a `bin` directory. The Windows zip layout (npm beside `node.exe`,
 * no `lib/`) is the other candidate.
 */
export function npmCliCandidates(execPath) {
  const dir = path.dirname(execPath);
  const prefix = path.basename(dir) === "bin" ? path.dirname(dir) : dir;
  return [
    path.join(prefix, "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(prefix, "node_modules", "npm", "bin", "npm-cli.js"),
  ];
}

export function resolveNpmCli(execPath, existsSync) {
  return npmCliCandidates(execPath).find((candidate) => existsSync(candidate)) ?? null;
}

/**
 * Shell wrappers for the payload's npm. They live in `<runtime>/npm-bin`,
 * one directory below `node`, because the runtime directory itself is on
 * the PATH of terminals, agents, and the packaged server.
 */
export function npmShimScript(kind) {
  if (kind !== "npm" && kind !== "npx") throw new Error(`Unknown npm shim "${kind}"`);
  return `#!/bin/sh
dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
root=$(CDPATH= cd -- "$dir/.." && pwd)
exec "$root/node" "$root/lib/node_modules/npm/bin/${kind}-cli.js" "$@"
`;
}

/** `<runtime>/npm-bin` next to a payload `node`, or `<prefix>/bin/npm-bin` for any other Node. */
export function npmShimDir(execPath) {
  return path.join(path.dirname(execPath), "npm-bin");
}

/** Write `npm` and `npx` into `<runtime>/npm-bin`. Returns that directory. */
export function installPayloadNpmShims(runtimeDir, io = fs) {
  const shimDir = path.join(runtimeDir, "npm-bin");
  io.mkdirSync(shimDir, { recursive: true });
  for (const kind of ["npm", "npx"]) {
    const shim = path.join(shimDir, kind);
    io.writeFileSync(shim, npmShimScript(kind));
    io.chmodSync(shim, 0o755);
  }
  return shimDir;
}

/**
 * Put this Node's directory first on PATH so lifecycle scripts (`node`, `tsx`)
 * use it. When `<that dir>/npm-bin` exists, prepend it too: that is where the
 * payload keeps npm and npx, off the directory user-facing processes inherit.
 */
export function withNodeToolchain(env, execPath, existsSync = fs.existsSync) {
  const nodeDir = path.dirname(execPath);
  const shimDir = npmShimDir(execPath);
  const prepend = [];
  if (existsSync(shimDir)) prepend.push(shimDir);
  prepend.push(nodeDir);
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const current = env[pathKey] ?? "";
  const skip = new Set(prepend);
  const parts = current.split(path.delimiter).filter((entry) => entry && !skip.has(entry));
  return { ...env, [pathKey]: [...prepend, ...parts].join(path.delimiter) };
}

/** Parsed JSON equality with the `libc` field removed and object keys sorted. */
export function canonicalLockJson(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalLockJson(entry)).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).filter((key) => key !== "libc").sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalLockJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** True when two lockfiles differ only by npm's optional `libc` metadata. */
export function lockfilesMatchIgnoringLibc(beforeText, afterText) {
  try {
    return canonicalLockJson(JSON.parse(beforeText)) === canonicalLockJson(JSON.parse(afterText));
  } catch {
    return false;
  }
}

/** Restore tsconfig only when the build dirtied a file that was clean before it. */
export function shouldRestoreTsconfig(wasClean, afterPorcelain) {
  if (!wasClean) return false;
  return afterPorcelain.split("\n").some((line) => line.trim() && line.includes("tsconfig.json"));
}
