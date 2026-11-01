#!/usr/bin/env node
/** Build the checkout-independent core/Vite desktop payload. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { isUtf8 } from "node:buffer";
import { builtinModules, createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { dashboardDir, desktopDir, repoRoot, stagingDir } from "./staging-paths.mjs";
import { NATIVE_BINARY_PATTERN, foreignBinaryReason } from "./native-binaries.mjs";
import { isEntry } from "./is-entry.mjs";

const require = createRequire(import.meta.url);
const log = (message) => process.stdout.write(`[stage-dashboard] ${message}\n`);
const slash = (value) => value.split(path.sep).join("/");
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const inside = (root, file) => { const rel = path.relative(root, file); return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel)); };

async function git(args) {
  const previous = process.env.TSX_TSCONFIG_PATH;
  process.env.TSX_TSCONFIG_PATH = path.join(dashboardDir, "tsconfig.json");
  let execExternal;
  try {
    const requireDashboard = createRequire(path.join(dashboardDir, "package.json"));
    execExternal = requireDashboard("tsx/cjs/api").require(path.join(repoRoot, "apps/core/src/lib/exec-external.ts"), path.join(dashboardDir, "package.json")).execExternal;
  } finally {
    if (previous === undefined) delete process.env.TSX_TSCONFIG_PATH;
    else process.env.TSX_TSCONFIG_PATH = previous;
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  Object.assign(env, { GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: "1", GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" });
  const result = await execExternal("git", args, { cwd: repoRoot, env, binary: true, timeoutMs: 120000, maxBuffer: 32 * 1024 * 1024 });
  if (!result.stdoutBuffer || !isUtf8(result.stdoutBuffer)) throw new Error("Git output is not valid UTF-8");
  return result.stdoutBuffer.toString("utf8");
}

async function trackedInputs() {
  const entries = (await git(["ls-files", "-s", "-z"])).split("\0").filter(Boolean);
  const index = new Map();
  for (const entry of entries) {
    const match = /^(\d+) ([0-9a-f]+) 0\t([\s\S]+)$/.exec(entry);
    if (!match) throw new Error("Unmerged or unreadable git index; cannot establish build provenance");
    index.set(match[3], { mode: match[1], hash: match[2] });
  }
  const skipped = (await git(["ls-files", "-t", "-z"])).split("\0").filter((s) => s.startsWith("S ")).map((s) => s.slice(2));
  const committed = new Map();
  for (const entry of (await git(["ls-tree", "-r", "-z", "HEAD"])).split("\0").filter(Boolean)) {
    const match = /^(\d+) blob ([0-9a-f]+)\t([\s\S]+)$/.exec(entry);
    if (match) committed.set(match[3], { mode: match[1], hash: match[2] });
  }
  return { index, committed, skipped: new Set(skipped) };
}

// npm's lockfile integrity identifies the original archive, not the extracted
// files. Compare every consumed package file to that archive before trusting it.
export function archiveFiles(integrity, cacheRoot) {
  let archive;
  for (const token of integrity.split(/\s+/)) {
    const match = /^(sha512|sha384|sha256|sha1)-([A-Za-z0-9+/]+={0,2})(?:\?.*)?$/.exec(token);
    if (!match) continue;
    const digest = Buffer.from(match[2], "base64");
    const hex = digest.toString("hex");
    const file = path.join(cacheRoot, "_cacache", "content-v2", match[1], hex.slice(0, 2), hex.slice(2, 4), hex.slice(4));
    if (!fs.existsSync(file)) continue;
    const bytes = fs.readFileSync(file);
    if (!crypto.createHash(match[1]).update(bytes).digest().equals(digest)) throw new Error(`Corrupt npm cache archive: ${file}`);
    archive = zlib.gunzipSync(bytes, { maxOutputLength: 512 * 1024 * 1024 });
    break;
  }
  if (!archive) throw new Error("Package archive is missing from the npm cache; provenance cannot be verified");
  const files = new Map();
  let offset = 0, paxPath, longPath;
  const text = (bytes) => bytes.toString("utf8").replace(/\0.*$/s, "");
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) break;
    const rawSize = text(header.subarray(124, 136)).trim();
    if (!/^[0-7]+$/.test(rawSize)) throw new Error("Unsupported npm archive size");
    const size = Number.parseInt(rawSize, 8);
    if (!Number.isSafeInteger(size) || offset + size > archive.length) throw new Error("Truncated npm archive");
    const content = archive.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;
    const type = String.fromCharCode(header[156] || 48);
    if (type === "x" || type === "g") {
      let at = 0;
      while (at < content.length) {
        const space = content.indexOf(32, at);
        if (space < 0) throw new Error("Invalid npm archive metadata");
        const length = Number(content.subarray(at, space).toString("ascii"));
        if (!Number.isInteger(length) || length <= space - at || at + length > content.length) throw new Error("Invalid npm archive metadata length");
        const record = content.subarray(space + 1, at + length - 1).toString("utf8");
        if (type === "x" && record.startsWith("path=")) paxPath = record.slice(5);
        at += length;
      }
      continue;
    }
    if (type === "L") { longPath = text(content); continue; }
    const prefix = text(header.subarray(345, 500));
    const raw = paxPath ?? longPath ?? (prefix ? `${prefix}/${text(header.subarray(0, 100))}` : text(header.subarray(0, 100)));
    paxPath = undefined; longPath = undefined;
    // Extraction drops "." segments and the root folder, whatever it is called
    // (@types/* use the package name; agent-base ships package/./dist/index.js).
    const parts = raw.replace(/\/$/, "").split("/").filter((part) => part !== ".");
    if (parts.some((part) => !part || part === ".." || part.includes("\\"))) throw new Error("Unsafe npm archive path");
    if (type !== "0") continue;
    const relative = parts.slice(1).join("/");
    const digest = crypto.createHash("sha256").update(content).digest("hex");
    if (!relative || files.has(relative) && files.get(relative) !== digest) throw new Error(`Duplicate npm archive entry: ${relative}`);
    files.set(relative, digest);
  }
  if (!files.size) throw new Error("Empty npm package archive");
  return files;
}

async function sourceAuditor() {
  const { index, committed, skipped } = await trackedInputs();
  const inputs = new Map(), archives = new Map();
  const cacheRoot = process.env.npm_config_cache || process.env.NPM_CONFIG_CACHE || path.join(os.homedir(), ".npm");
  const lockPath = path.join(repoRoot, "package-lock.json");
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  if (!lock.packages || typeof lock.packages !== "object") throw new Error("Workspace lockfile has no package provenance");
  return {
    check(file) {
      const absolute = path.resolve(file);
      if (/^(?:\.env(?:\.|$)|credentials?\.json$|id_rsa|.*\.(?:pem|key)$)/i.test(path.basename(absolute))) throw new Error(`Credential-shaped build input: ${absolute}`);
      const resolved = fs.realpathSync(absolute);
      if (!inside(repoRoot, resolved)) throw new Error(`Build input outside checkout: ${absolute}`);
      const relative = slash(path.relative(repoRoot, resolved));
      if (/(?:^|\/)plugin-brand-logo\.[^/]+$/.test(relative)) throw new Error(`Plugin branding copy is a build input: ${relative}`);
      const parts = relative.split("/");
      if (parts.includes("node_modules")) {
        let packagePath;
        for (let i = parts.length - 1; i >= 0; i--) {
          if (parts[i] !== "node_modules" || !parts[i + 1]) continue;
          const length = parts[i + 1].startsWith("@") ? 2 : 1;
          const candidate = parts.slice(0, i + 1 + length).join("/");
          if (lock.packages[candidate]) { packagePath = candidate; break; }
        }
        const locked = packagePath && lock.packages[packagePath];
        const manifestPath = packagePath && path.join(repoRoot, packagePath, "package.json");
        if (!locked || typeof locked.integrity !== "string" || !manifestPath || !fs.existsSync(manifestPath)) throw new Error(`Unverified installed package: ${relative}`);
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        if (!locked.version || locked.version !== manifest.version) throw new Error(`Installed package does not match lockfile: ${packagePath}`);
        if (!archives.has(locked.integrity)) archives.set(locked.integrity, archiveFiles(locked.integrity, cacheRoot));
        const packageRelative = parts.slice(packagePath.split("/").length).join("/");
        const digest = sha256(resolved);
        if (archives.get(locked.integrity).get(packageRelative) !== digest) {
          // esbuild replaces its JS launcher with the platform binary during npm ci.
          if (!packagePath.endsWith("/esbuild") || !["bin/esbuild", "bin/esbuild.exe"].includes(packageRelative)) throw new Error(`Installed package file differs from its locked archive: ${relative}`);
          const native = packageRoot(`@esbuild/${os.platform()}-${os.arch()}`, path.dirname(manifestPath));
          const binary = path.join(native, os.platform() === "win32" ? "esbuild.exe" : "bin/esbuild");
          this.check(binary);
          if (sha256(binary) !== digest) throw new Error(`Unverified esbuild executable: ${relative}`);
        }
        inputs.set(relative, digest);
        return;
      }
      const entry = index.get(relative);
      if (!entry || entry.mode !== "100644" && entry.mode !== "100755" || skipped.has(relative)) {
        throw new Error(`Unknown, symlinked or skip-worktree build input: ${relative}`);
      }
      const baseline = committed.get(relative);
      if (!baseline || baseline.mode !== entry.mode || baseline.hash !== entry.hash) throw new Error(`Build input is not committed: ${relative}`);
      let current = repoRoot;
      for (const component of relative.split("/")) {
        current = path.join(current, component);
        if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Symlinked build input: ${relative}`);
      }
      const bytes = fs.readFileSync(resolved);
      const blob = crypto.createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
      if (blob !== entry.hash) throw new Error(`Build input differs from the git index: ${relative}`);
      inputs.set(relative, sha256(resolved));
    },
    list: () => Object.fromEntries([...inputs].sort(([a], [b]) => a.localeCompare(b))),
  };
}

function walkFiles(root) {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symlink in staged payload: ${file}`);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) files.push(file);
      else throw new Error(`Unsupported staged input: ${file}`);
    }
  }
  walk(root);
  return files;
}

function assertNoCopies(root) {
  for (const file of walkFiles(root)) {
    const rel = slash(path.relative(root, file));
    if (["devhub-plugin.json", "devhub-mcp-toolsets.json", "plugin-desktop-icon.png"].includes(path.basename(file)) || /^\.env(?:\.|$)/.test(path.basename(file))) {
      throw new Error(`Plugin copy or environment file in payload: ${rel}`);
    }
    if (!rel.split("/").includes("node_modules") && /\.(?:js|mjs|cjs|json)$/.test(file)) {
      const text = fs.readFileSync(file, "utf8");
      if (/["']?sourceRoot["']?\s*:\s*["'][^"']+["']\s*,\s*["']?fingerprint["']?\s*:\s*["'][a-f0-9]{64}["']/.test(text)) throw new Error(`Plugin receipt in payload: ${rel}`);
    }
  }
}

function packageRoot(name, from) {
  let directory = from;
  while (true) {
    const candidate = path.join(directory, "node_modules", ...name.split("/"));
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory || !inside(repoRoot, parent)) break;
    directory = parent;
  }
  throw new Error(`Missing runtime dependency ${name} (from ${from})`);
}

function auditBuildTools(names, audit) {
  const seen = new Set();
  function visit(name, from, optional = false) {
    let source;
    try { source = packageRoot(name, from); } catch (error) { if (optional) return; throw error; }
    source = fs.realpathSync(source);
    if (seen.has(source)) return;
    seen.add(source);
    audit.check(path.join(source, "package.json"));
    const manifest = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8"));
    function scan(directory) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (directory === source && entry.name === "node_modules") continue;
        if (/^(?:\.env(?:\.|$)|credentials?\.json$|id_rsa|.*\.(?:pem|key)$)/i.test(entry.name)) continue;
        const file = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error(`Symlink in build dependency: ${file}`);
        if (entry.isDirectory()) scan(file);
        else if (entry.isFile()) audit.check(file);
        else throw new Error(`Unsupported build dependency input: ${file}`);
      }
    }
    scan(source);
    const optionalDeps = manifest.optionalDependencies ?? {};
    for (const dependency of Object.keys({ ...manifest.dependencies, ...optionalDeps, ...manifest.peerDependencies })) {
      visit(dependency, source, Object.hasOwn(optionalDeps, dependency) || manifest.peerDependenciesMeta?.[dependency]?.optional === true);
    }
  }
  for (const name of names) visit(name, dashboardDir);
}

// Tailwind scans beyond the Vite module graph, including ignored files.
function auditUi(audit, directory = dashboardDir) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name.endsWith(".tsbuildinfo") || ["node_modules", "dist", "output", "coverage", "test-results", "playwright-report"].includes(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlinked UI input: ${file}`);
    if (entry.isDirectory()) auditUi(audit, file);
    else if (entry.isFile()) audit.check(file);
    else throw new Error(`Unsupported UI build input: ${file}`);
  }
}

function stageDependencies(names, dest, audit) {
  const seen = new Map();
  function copy(name, from, destination, available, optional = false) {
    let source;
    try { source = packageRoot(name, from); } catch (error) { if (optional) return; throw error; }
    const real = fs.realpathSync(source);
    if (!inside(repoRoot, real) || !slash(real).split("/").includes("node_modules")) throw new Error(`Runtime dependency leaves node_modules: ${source}`);
    if (available.get(name) === real) return;
    // Mirror the hoisted source layout so Node resolves the same copies; nest only on a clash.
    const mirrored = path.join(dest, "node_modules", ...slash(real).split("/node_modules/").slice(1).join("/node_modules/").split("/"));
    const target = !seen.has(mirrored) || seen.get(mirrored) === real ? mirrored : path.join(destination, "node_modules", ...name.split("/"));
    if (seen.has(target)) {
      if (seen.get(target) !== real) throw new Error(`Conflicting runtime dependency ${name}`);
      return;
    }
    seen.set(target, real);
    const manifest = JSON.parse(fs.readFileSync(path.join(real, "package.json"), "utf8"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(real, target, { recursive: true, dereference: false, filter: (src) => src !== path.join(real, "node_modules") && !/^(?:\.env(?:\.|$)|credentials?\.json$|id_rsa|.*\.(?:pem|key)$)/i.test(path.basename(src)) });
    for (const file of walkFiles(target)) {
      audit.check(path.join(real, path.relative(target, file)));
      if (NATIVE_BINARY_PATTERN.test(path.basename(file))) {
        const reason = foreignBinaryReason(fs.readFileSync(file), os.platform());
        if (reason) fs.rmSync(file);
      }
    }
    const inherited = new Map(available);
    inherited.set(name, real);
    const optionalDeps = manifest.optionalDependencies ?? {};
    const peerDeps = manifest.peerDependencies ?? {};
    for (const dependency of Object.keys({ ...manifest.dependencies, ...optionalDeps, ...peerDeps })) {
      const optional = Object.hasOwn(optionalDeps, dependency) || manifest.peerDependenciesMeta?.[dependency]?.optional === true;
      copy(dependency, real, target, inherited, optional);
    }
  }
  for (const name of names) copy(name, dashboardDir, dest, new Map());
}

let esbuild;
async function buildBundle(options) { return esbuild.build(options); }

function stageNodePty(servicesDir, audit, { platform = os.platform(), arch = os.arch() } = {}) {
  const src = path.dirname(require.resolve("node-pty/package.json", { paths: [dashboardDir] }));
  const dest = path.join(servicesDir, "node_modules", "node-pty");
  fs.mkdirSync(dest, { recursive: true });

  // Only what the module actually loads. `src/`, `third_party/`, and the
  // binding.gyp are build inputs, and the other platforms' prebuilds are five
  // extra native binaries that would each need signing and notarising for no
  // reason — every one is a Gatekeeper failure waiting to be discovered by a
  // user rather than by us.
  for (const entry of ["package.json", "lib", "typings", "LICENSE"]) {
    const from = path.join(src, entry);
    if (fs.existsSync(from)) {
      fs.cpSync(from, path.join(dest, entry), { recursive: true, dereference: false });
    }
  }

  // node-pty resolves its binding from `prebuilds/<platform>-<arch>/` at
  // runtime, so the directory name must match exactly what Node reports on the
  // target machine.
  const prebuiltDir = `${platform}-${arch}`;
  const from = path.join(src, "prebuilds", prebuiltDir);
  if (!fs.existsSync(from)) {
    const available = fs.existsSync(path.join(src, "prebuilds"))
      ? fs.readdirSync(path.join(src, "prebuilds")).join(", ")
      : "(none)";
    throw new Error(
      `node-pty has no prebuilt binding for ${prebuiltDir}. Available: ${available}. ` +
        `Shipping without it gives a terminal that fails at runtime, so this is a build error.`,
    );
  }
  const to = path.join(dest, "prebuilds", prebuiltDir);
  fs.cpSync(from, to, { recursive: true, dereference: false });

  const natives = fs.readdirSync(to).filter((f) => f.endsWith(".node"));
  if (natives.length === 0) {
    throw new Error(`Staged node-pty prebuild ${prebuiltDir} contains no .node binding.`);
  }
  for (const file of walkFiles(dest)) audit.check(path.join(src, path.relative(dest, file)));
  log(`staged node-pty for ${prebuiltDir} (${natives.join(", ")})`);
}

async function stageServices(servicesDir, buildOptions, audit) {
  fs.rmSync(servicesDir, { recursive: true, force: true });
  fs.mkdirSync(servicesDir, { recursive: true });

  // CJS: node-pty is a CommonJS native addon, and an ESM bundle would need a
  // createRequire dance for no benefit in a file nothing else imports.
  await buildBundle({
    entryPoints: [path.join(repoRoot, "apps/core/src/local/terminal/server.ts")],
    outfile: path.join(servicesDir, "terminal-pty-server.cjs"),
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    external: ["node-pty"],
    logLevel: "warning",
    ...buildOptions,
  });
  log("bundled terminal-pty-server.cjs");

  // Agent runner: a terminal tab runs this (with the app's node) for each
  // dispatched agent run. See apps/ui/lib/agent-runs/launch.ts.
  await buildBundle({
    entryPoints: [path.join(dashboardDir, "../core/src/scripts/agent-run.ts")],
    outfile: path.join(servicesDir, "agent-run.cjs"),
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    logLevel: "warning",
    ...buildOptions,
  });
  log("bundled agent-run.cjs");

  await buildBundle({
    entryPoints: [path.join(repoRoot, "apps/core/src/domains/storage/export-runs.ts")],
    outfile: path.join(servicesDir, "storage-export-runs.cjs"),
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    logLevel: "warning",
    ...buildOptions,
  });
  log("bundled storage-export-runs.cjs");

  stageNodePty(servicesDir, audit);

  fs.copyFileSync(
    path.join(desktopDir, "sidecar", "supervisor.mjs"),
    path.join(servicesDir, "supervisor.mjs"),
  );
  log("staged supervisor.mjs");
  fs.copyFileSync(path.join(desktopDir, "sidecar", "managed-tools.mjs"), path.join(servicesDir, "managed-tools.mjs"));
  fs.copyFileSync(path.join(desktopDir, "sidecar", "cleanup-orphans.mjs"), path.join(servicesDir, "cleanup-orphans.mjs"));
}


function outputManifest(root, excludeProvenance = false) {
  return Object.fromEntries(walkFiles(root).filter((file) => !excludeProvenance || file !== path.join(root, "provenance.json"))
    .map((file) => [slash(path.relative(root, file)), sha256(file)]).sort(([a], [b]) => a.localeCompare(b)));
}

export function verifyPayload(root = stagingDir) {
  return verifyStagedPayload(root);
}

async function verifyStagedPayload(root) {
  const manifestFile = path.join(root, "server", "provenance.json");
  if (!fs.existsSync(manifestFile)) throw new Error("Missing core/Vite build provenance");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  if (manifest.format !== 1 || !manifest.inputs || Array.isArray(manifest.inputs) || typeof manifest.inputs !== "object" || !manifest.outputs || Array.isArray(manifest.outputs) || typeof manifest.outputs !== "object") throw new Error("Unrecognized core/Vite build provenance");
  for (const input of ["package-lock.json", "apps/ui/index.html", "apps/ui/vite.config.ts", "apps/ui/src/main.tsx", "scripts/core-server.ts", "apps/desktop/scripts/stage-dashboard.mjs", "apps/desktop/sidecar/supervisor.mjs", "apps/desktop/sidecar/cleanup-orphans.mjs"]) {
    if (!Object.hasOwn(manifest.inputs, input)) throw new Error(`Provenance is missing input: ${input}`);
  }
  const audit = await sourceAuditor();
  audit.check(path.join(repoRoot, "package-lock.json"));
  auditUi(audit);
  auditBuildTools(["vite", "@vitejs/plugin-react", "@tailwindcss/postcss", "esbuild", "tsx"], audit);
  for (const [relative, digest] of Object.entries(manifest.inputs)) {
    if (typeof digest !== "string" || !inside(repoRoot, path.resolve(repoRoot, relative))) throw new Error("Invalid provenance input");
    const file = path.resolve(repoRoot, relative);
    audit.check(file);
    if (sha256(file) !== digest) throw new Error(`Build input changed: ${relative}`);
  }
  if (JSON.stringify(audit.list()) !== JSON.stringify(Object.fromEntries(Object.entries(manifest.inputs).sort(([a], [b]) => a.localeCompare(b))))) throw new Error("Incomplete build provenance");
  const outputs = {};
  for (const name of ["server", "services"]) {
    const dir = path.join(root, name);
    if (!fs.existsSync(dir)) throw new Error(`Missing staged ${name}`);
    for (const [file, digest] of Object.entries(outputManifest(dir, name === "server"))) outputs[`${name}/${file}`] = digest;
    assertNoCopies(dir);
  }
  if (JSON.stringify(Object.entries(outputs).sort()) !== JSON.stringify(Object.entries(manifest.outputs).sort())) throw new Error("Staged payload does not match build provenance");
  for (const required of ["server/core-server.mjs", "server/ui/dist/index.html", "services/supervisor.mjs", "services/managed-tools.mjs", "services/agent-run.cjs", "services/storage-export-runs.cjs", "services/terminal-pty-server.cjs", `services/node_modules/node-pty/prebuilds/${os.platform()}-${os.arch()}`]) {
    if (!fs.existsSync(path.join(root, required))) throw new Error(`Missing staged payload: ${required}`);
  }
  if (!walkFiles(path.join(root, "server/ui/dist")).some((file) => file.endsWith(".wasm"))) throw new Error("Missing terminal WASM asset");
}

function replaceStaged(root) {
  const moved = [];
  try {
    for (const name of ["server", "services"]) {
      const target = path.join(stagingDir, name), backup = path.join(root, `${name}.previous`);
      const entry = { target, backup, hadOld: fs.existsSync(target), installed: false };
      moved.push(entry);
      if (entry.hadOld) fs.renameSync(target, backup);
      fs.renameSync(path.join(root, name), target);
      entry.installed = true;
    }
  } catch (error) {
    for (const entry of moved.reverse()) {
      if (entry.installed) fs.rmSync(entry.target, { recursive: true, force: true });
      if (entry.hadOld && fs.existsSync(entry.backup)) fs.renameSync(entry.backup, entry.target);
    }
    throw error;
  }
}

export function stageDashboard(options) {
  return buildPayload(options);
}

async function buildPayload({ build = true } = {}) {
  if (!build) { await verifyStagedPayload(stagingDir); log("verified existing core/Vite payload"); return; }
  const audit = await sourceAuditor();
  audit.check(path.join(repoRoot, "package-lock.json"));
  for (const file of ["apps/ui/vite.config.ts", "apps/ui/postcss.config.mjs", "apps/ui/tsconfig.json", "apps/ui/index.html", "apps/ui/package.json", "apps/core/package.json", "package.json", "apps/desktop/scripts/stage-dashboard.mjs", "apps/desktop/sidecar/supervisor.mjs", "apps/desktop/sidecar/managed-tools.mjs", "apps/desktop/sidecar/cleanup-orphans.mjs"]) audit.check(path.join(repoRoot, file));
  auditUi(audit);
  auditBuildTools(["vite", "@vitejs/plugin-react", "@tailwindcss/postcss", "esbuild", "tsx"], audit);
  fs.mkdirSync(stagingDir, { recursive: true });
  const temp = fs.mkdtempSync(path.join(stagingDir, ".core-build-"));
  let retain = false;
  try {
    const server = path.join(temp, "server"), services = path.join(temp, "services");
    fs.mkdirSync(server, { recursive: true });
    const vite = await import(pathToFileURL(path.join(path.dirname(require.resolve("vite/package.json", { paths: [dashboardDir] })), "dist/node/index.js")).href);
    const previousEnv = { ...process.env };
    const previousCwd = process.cwd();
    process.chdir(dashboardDir);
    for (const key of Object.keys(process.env)) if (/^VITE_|^NEXT_PUBLIC_|^DEVHUB_|^NOTES_DIR$|^TASKS_DIR$|^REPO_ROOT$|^XDG_|^APPDATA$|^LOCALAPPDATA$/.test(key)) delete process.env[key];
    process.env.HOME = temp;
    process.env.USERPROFILE = temp;
    try {
      await vite.build({ root: dashboardDir, envDir: temp, build: { outDir: path.join(server, "ui/dist"), emptyOutDir: true }, plugins: [{
        name: "devhub-build-provenance",
        generateBundle() { for (const id of this.getModuleIds()) { const file = id.split("?")[0]; if (!file.startsWith("\0") && path.isAbsolute(file)) audit.check(file); } },
      }] });
    } finally { process.chdir(previousCwd); for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key]; Object.assign(process.env, previousEnv); }
    if (!walkFiles(path.join(server, "ui", "dist")).some((file) => file.endsWith(".wasm"))) throw new Error("Vite did not emit the terminal WASM asset");
    esbuild = require(require.resolve("esbuild", { paths: [dashboardDir] }));
    // pull-core resolves tsx dynamically when a user links a checkout.
    const externals = new Set(["tsx"]), serviceExternals = new Set();
    const workspacePlugin = { name: "workspace-packages", setup(build) {
      build.onResolve({ filter: /^@devhub\/(core|qa)(?:\/|$)/ }, (args) => ({ path: require.resolve(args.path, { paths: [args.resolveDir || dashboardDir] }) }));
    } };
    const externalPackages = { name: "runtime-packages", setup(build) {
      build.onResolve({ filter: /^[^./]/ }, (args) => {
        if (/^@(?:\/|shared\/|contracts\/)/.test(args.path) || path.isAbsolute(args.path)) return;
        return { path: args.path, external: true };
      });
    } };
    const buildOptions = { absWorkingDir: repoRoot, metafile: true, tsconfig: path.join(dashboardDir, "tsconfig.json"), plugins: [workspacePlugin] };
    const core = await buildBundle({ entryPoints: [path.join(repoRoot, "scripts/core-server.ts")], outfile: path.join(server, "core-server.mjs"), bundle: true, platform: "node", target: "node22", format: "esm", banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url); const __filename = require("node:url").fileURLToPath(import.meta.url); const __dirname = require("node:path").dirname(__filename);' }, logLevel: "warning", ...buildOptions, plugins: [workspacePlugin, externalPackages] });
    function inspect(result, outputExternals) {
      for (const file of Object.keys(result.metafile.inputs)) {
        audit.check(path.resolve(repoRoot, file));
      }
      for (const output of Object.values(result.metafile.outputs)) for (const entry of output.imports) {
        if (!entry.external || entry.path.startsWith("node:") || builtinModules.includes(entry.path)) continue;
        const parts = entry.path.split("/");
        outputExternals.add(entry.path.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]);
      }
    }
    inspect(core, externals);
    // Capture service build graphs too; node-pty is staged separately next to the terminal.
    const serviceOptions = { ...buildOptions, plugins: [...buildOptions.plugins, { name: "capture-service-inputs", setup(build) { build.onEnd((result) => { if (result.metafile) inspect(result, serviceExternals); }); } }] };
    await stageServices(services, serviceOptions, audit);
    stageDependencies(externals, server, audit);
    serviceExternals.delete("node-pty");
    // Bundled ws probes these optional native addons in try/catch and falls back to JS.
    serviceExternals.delete("bufferutil");
    serviceExternals.delete("utf-8-validate");
    stageDependencies(serviceExternals, services, audit);
    const commit = (await git(["rev-parse", "HEAD"])).trim();
    const marker = { commit, builtAt: new Date().toISOString(), release: process.env.GITHUB_ACTIONS === "true" };
    if (/^[0-9a-f]{7,40}$/i.test(process.env.DEVHUB_SOURCE_COMMIT ?? "")) marker.sourceCommit = process.env.DEVHUB_SOURCE_COMMIT;
    fs.writeFileSync(path.join(server, "bundle-source.json"), `${JSON.stringify(marker, null, 2)}\n`);
    const outputs = {};
    for (const name of ["server", "services"]) for (const [file, digest] of Object.entries(outputManifest(path.join(temp, name), name === "server"))) outputs[`${name}/${file}`] = digest;
    fs.writeFileSync(path.join(server, "provenance.json"), `${JSON.stringify({ format: 1, inputs: audit.list(), outputs }, null, 2)}\n`);
    await verifyStagedPayload(temp);
    try { replaceStaged(temp); }
    catch (error) { retain = true; throw new Error(`Staging replacement failed; recovery files retained at ${temp}`, { cause: error }); }
    log("staged core server, Vite assets and services");
  } finally { if (!retain) fs.rmSync(temp, { recursive: true, force: true }); }
}

if (isEntry(import.meta.url)) {
  stageDashboard({ build: !process.argv.includes("--no-build") }).catch((error) => { process.stderr.write(`[stage-dashboard] ${error.message}\n`); process.exitCode = 1; });
}
