#!/usr/bin/env node
/** Build in an isolated core checkout before replacing a current installed payload. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isUtf8 } from "node:buffer";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { isPersonalSourcePath, stageResources } from "./stage-resources.mjs";
import { buildEnvFile, repoRoot, resolveWorkspacePaths, serverDir as stagedServerDir, servicesDir as stagedServicesDir, resourcesDir as stagedResourcesDir } from "./staging-paths.mjs";
import { signBundle, verifyBundle } from "./codesign-bundle.mjs";
import { isEntry } from "./is-entry.mjs";

const { cleanBuildEnv } = await import(pathToFileURL(buildEnvFile).href);
const fail = (msg) => { process.stderr.write(`[rebuild-installed-server] ${msg}\n`); process.exitCode = 1; };
const log = (msg) => process.stdout.write(`[rebuild-installed-server] ${msg}\n`);
function inside(root, file) { const rel = path.relative(root, file); return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel)); }
function confinedPath(root, relative) {
  const target = path.resolve(root, relative);
  if (!relative || !inside(root, target) || target === root) throw new Error(`Path escapes its root: ${relative}`);
  return target;
}
function execTool(root) {
  const dashboard = resolveWorkspacePaths(root).dashboardDir;
  const packageFile = path.join(dashboard, "package.json");
  const requireDashboard = createRequire(packageFile);
  const previous = process.env.TSX_TSCONFIG_PATH;
  process.env.TSX_TSCONFIG_PATH = path.join(dashboard, "tsconfig.json");
  try { return requireDashboard("tsx/cjs/api").require(path.join(root, "apps/core/src/lib/exec-external.ts"), packageFile).execExternal; }
  finally { if (previous === undefined) delete process.env.TSX_TSCONFIG_PATH; else process.env.TSX_TSCONFIG_PATH = previous; }
}
function isolatedBuildEnv(env, hooks) {
  const allowed = new Set(["PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TMPDIR", "TMP", "TEMP", "LANG", "LANGUAGE", "TZ", "TERM", "NO_COLOR", "FORCE_COLOR", "CI"]);
  const result = Object.fromEntries(Object.entries(cleanBuildEnv(env)).filter(([key]) => allowed.has(key.toUpperCase()) || key.startsWith("LC_")));
  return { ...result, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: hooks, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GIT_LITERAL_PATHSPECS: "1" };
}

function snapshotSource(source, checkout, names) {
  const checkedDirs = new Set([source]);
  const desktopRelative = path.relative(source, resolveWorkspacePaths(source).desktopDir).split(path.sep).join("/");
  for (const relative of new Set(names)) {
    if (!relative) continue;
    const parts = relative.split("/");
    if (parts.some((part) => !part || part === "." || part === "..") || relative.includes("\0")) {
      throw new Error(`Invalid checkout path: ${relative}`);
    }
    if (isPersonalSourcePath(relative) ||
        parts.some((part) => part === ".git" || part === "node_modules" || /^(?:\.env(?:\.|$)|credentials?\.json$|id_rsa|.*\.(?:pem|key)$)/i.test(part) || /^\.next(?:-|$)/.test(part)) ||
        relative.startsWith(`${desktopRelative}/staging/`) || relative.startsWith(`${desktopRelative}/src-tauri/target/`)) continue;
    const from = confinedPath(source, relative);
    let stat;
    try { stat = fs.lstatSync(from); }
    catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    let directory = source;
    for (const part of parts.slice(0, -1)) {
      directory = path.join(directory, part);
      if (checkedDirs.has(directory)) continue;
      if (fs.lstatSync(directory).isSymbolicLink()) throw new Error(`Refusing symlink in checkout: ${directory}`);
      checkedDirs.add(directory);
    }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Unsupported checkout input: ${from}`);
    const to = confinedPath(checkout, relative);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to, fs.constants.COPYFILE_FICLONE);
    fs.chmodSync(to, stat.mode & 0o777);
  }
}

function copyDependencies(source, checkout) {
  const dependencyRoots = ["node_modules", ...["apps/core", "apps/ui", "apps/desktop", "packages/shared", "packages/mcp", "packages/qa"].map((workspace) => path.join(workspace, "node_modules"))];
  const safeRoots = dependencyRoots.map((relative) => path.join(fs.realpathSync(source), relative));
  for (const relative of dependencyRoots) {
    const from = path.join(source, relative);
    let stat;
    try { stat = fs.lstatSync(from); }
    catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    const resolved = fs.realpathSync(from);
    if (stat.isSymbolicLink() && !safeRoots.some((root) => inside(root, resolved))) {
      throw new Error(`Dependency root symlink leaves the build checkout: ${from}`);
    }
    if (!fs.statSync(resolved).isDirectory()) throw new Error(`Unsupported dependency root: ${from}`);
    const to = path.join(checkout, relative);
    if (fs.existsSync(to)) throw new Error(`Plugin contribution conflicts with ${relative}.`);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(resolved, to, {
      recursive: true, dereference: false, verbatimSymlinks: true, mode: fs.constants.COPYFILE_FICLONE,
      filter: (file) => !/^(?:\.env(?:\.|$)|credentials?\.json$|id_rsa|.*\.(?:pem|key)$)/i.test(path.basename(file)),
    });
    const visit = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(file);
        else if (entry.isSymbolicLink()) {
          const link = fs.readlinkSync(file);
          const target = path.resolve(path.dirname(file), link);
          if (inside(checkout, target)) continue;
          if (!path.isAbsolute(link) || !inside(source, target)) {
            throw new Error(`Dependency symlink leaves the build checkout: ${file} -> ${link}`);
          }
          const mapped = path.join(checkout, path.relative(source, target));
          const type = fs.statSync(file).isDirectory() ? "dir" : "file";
          fs.unlinkSync(file);
          fs.symlinkSync(mapped, file, type);
        }
      }
    };
    visit(to);
  }
}

export async function stageCoreDashboard({ sourceRoot = repoRoot, toolsRoot = sourceRoot, env = process.env, temporaryRoot = os.tmpdir(), stage, stageRes, includeResources = false } = {}) {
  const execExternal = execTool(toolsRoot);
  // Resolve symlinks (macOS $TMPDIR is /var -> /private/var): child scripts gate their
  // entry point on import.meta.url, which Node reports as the real path.
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(temporaryRoot, "devhub-core-rebuild-")));
  const checkout = path.join(temporary, "checkout"), hooks = path.join(temporary, "hooks"), home = path.join(temporary, "home");
  fs.mkdirSync(hooks); fs.mkdirSync(home);
  const buildEnv = { ...isolatedBuildEnv(env, hooks), npm_config_cache: env.npm_config_cache || env.NPM_CONFIG_CACHE || path.join(env.HOME || os.homedir(), ".npm"), HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, ".config"), XDG_DATA_HOME: path.join(home, ".local/share"), XDG_STATE_HOME: path.join(home, ".local/state"), XDG_CACHE_HOME: path.join(home, ".cache"), APPDATA: path.join(home, "AppData/Roaming"), LOCALAPPDATA: path.join(home, "AppData/Local"), DEVHUB_SCHEDULER: "0", DEVHUB_MCP_HTTP: "0" };
  const git = (args, options = {}) => execExternal("git", args, { cwd: sourceRoot, env: buildEnv, timeoutMs: 120_000, ...options });
  try {
    const head = (await git(["rev-parse", "HEAD"])).stdout.trim();
    const skipped = await git(["ls-files", "-t", "-z"], { binary: true });
    if (!isUtf8(skipped.stdoutBuffer)) throw new Error("Cannot inspect checkout paths as UTF-8");
    const unsafe = skipped.stdoutBuffer.toString("utf8").split("\0").filter((entry) => /^S (?:apps\/(?:ui|core)|packages|shared)\//.test(entry));
    if (unsafe.length) throw new Error(`Skip-worktree build inputs have uncertain provenance: ${unsafe.join(", ")}`);
    await git(["clone", "--shared", "--no-checkout", "--", sourceRoot, checkout]);
    if ((await git(["rev-parse", "HEAD"], { cwd: checkout })).stdout.trim() !== head) throw new Error("Checkout changed while preparing the build");
    const index = await git(["ls-files", "--stage", "-z"], { binary: true });
    await git(["read-tree", "--empty"], { cwd: checkout });
    if (index.stdoutBuffer?.length) await git(["update-index", "-z", "--index-info"], { cwd: checkout, input: index.stdoutBuffer });
    const files = await git(["ls-files", "--cached", "-z"], { binary: true });
    if (!isUtf8(files.stdoutBuffer)) throw new Error("Cannot copy checkout paths as UTF-8");
    snapshotSource(sourceRoot, checkout, files.stdoutBuffer.toString("utf8").split("\0"));
    copyDependencies(sourceRoot, checkout);
    const desktop = resolveWorkspacePaths(checkout).desktopDir;
    if (stage) await stage({ checkout, env: buildEnv });
    // The isolated env drops NODE_OPTIONS; Vite exceeds Node's default 2 GiB heap.
    else await execExternal(process.execPath, ["--max-old-space-size=4096", path.join(desktop, "scripts/stage-dashboard.mjs")], { cwd: checkout, env: buildEnv, timeoutMs: 30 * 60_000, onStdout: (chunk) => process.stdout.write(chunk) });
    if (includeResources) {
      if (stageRes) await stageRes({ checkout, env: buildEnv });
      else await execExternal(process.execPath, [path.join(desktop, "scripts/stage-resources.mjs")], { cwd: checkout, env: buildEnv, timeoutMs: 120_000, onStdout: (chunk) => process.stdout.write(chunk) });
    }
    return { stagedServer: path.join(desktop, "staging/server"), stagedServices: path.join(desktop, "staging/services"), stagedResources: path.join(desktop, "staging/resources"), dispose: () => fs.rmSync(temporary, { recursive: true, force: true }) };
  } catch (error) { fs.rmSync(temporary, { recursive: true, force: true }); throw error; }
}

function replaceDirectories(pairs, { retainSuccessful = false } = {}) {
  const prepared = [];
  let failure;
  try {
    for (const { from, to, required = [] } of pairs) {
      const source = fs.realpathSync(from);
      const target = fs.realpathSync(to);
      if (source === target) continue;
      if (inside(source, target) || inside(target, source)) {
        throw new Error(`Staged and installed directories overlap: ${from}, ${to}`);
      }
      if (prepared.some((entry) => inside(entry.target, target) || inside(target, entry.target))) {
        throw new Error(`Installed directories overlap: ${to}`);
      }
      const temporary = fs.mkdtempSync(path.join(path.dirname(target), `.${path.basename(target)}-rebuild-`));
      const entry = {
        from, to, target, temporary,
        incoming: path.join(temporary, "incoming"),
        backup: path.join(temporary, "backup"),
        saved: [], installed: [], retain: false,
      };
      prepared.push(entry);
      fs.mkdirSync(entry.backup);
      fs.cpSync(from, entry.incoming, { recursive: true, dereference: true });
      for (const relative of required) {
        if (!fs.existsSync(path.join(entry.incoming, relative))) {
          throw new Error(`copy failed — ${relative} missing from prepared ${to}`);
        }
      }
    }
    for (const entry of prepared) {
      for (const name of fs.readdirSync(entry.to)) {
        fs.renameSync(path.join(entry.to, name), path.join(entry.backup, name));
        entry.saved.push(name);
      }
      for (const name of fs.readdirSync(entry.incoming)) {
        fs.renameSync(path.join(entry.incoming, name), path.join(entry.to, name));
        entry.installed.push(name);
      }
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const entry of prepared.toReversed()) {
      for (const name of entry.installed.toReversed()) {
        try { fs.renameSync(path.join(entry.to, name), path.join(entry.incoming, name)); }
        catch (rollbackError) { entry.retain = true; rollbackErrors.push(rollbackError); }
      }
      for (const name of entry.saved.toReversed()) {
        try { fs.renameSync(path.join(entry.backup, name), path.join(entry.to, name)); }
        catch (rollbackError) { entry.retain = true; rollbackErrors.push(rollbackError); }
      }
    }
    failure = rollbackErrors.length
      ? new AggregateError([error, ...rollbackErrors], `Rebuild rollback failed; backups retained at ${prepared.filter((entry) => entry.retain).map((entry) => entry.backup).join(", ")}`)
      : error;
  }
  if (!failure && retainSuccessful) {
    for (const entry of prepared) {
      entry.retain = true;
      log(`previous payload retained at ${entry.backup}`);
    }
  }
  for (const entry of prepared) {
    if (entry.retain) continue;
    try { fs.rmSync(entry.temporary, { recursive: true, force: true }); }
    catch (cleanupError) {
      failure = failure
        ? new AggregateError([failure, cleanupError], `Rebuild cleanup failed at ${entry.temporary}`)
        : cleanupError;
    }
  }
  if (failure) throw failure;
}

/** Replace `to`'s contents with `from` without removing the destination inode. */
export function replaceDirContents(from, to) {
  replaceDirectories([{ from, to }]);
}

/**
 * Packaged layout is `Resources/server` beside `Resources/services`.
 * An older DevHub binary only exports DEVHUB_SERVER_DIR; derive the sibling
 * so View → Rebuild Dashboard still restages the services tree.
 */
export function resolveServicesTarget(serverTarget, env = process.env) {
  const fromEnv = env.DEVHUB_SERVICES_DIR?.trim();
  if (fromEnv) {
    if (!path.isAbsolute(fromEnv)) {
      throw new Error(`DEVHUB_SERVICES_DIR must be absolute (got ${fromEnv})`);
    }
    return fromEnv;
  }
  return path.resolve(serverTarget, "..", "services");
}

export async function rebuildInstalledServer({
  serverTarget = process.env.DEVHUB_SERVER_DIR?.trim(),
  servicesTarget,
  stagedServer = stagedServerDir,
  stagedServices = stagedServicesDir,
  stagedResources = stagedResourcesDir,
  stage,
  prepare = stageCoreDashboard,
  stageRes = stageResources,
} = {}) {
  if (!serverTarget) {
    throw new Error(
      "DEVHUB_SERVER_DIR is required. The desktop shell should pass the packaged server path.",
    );
  }
  if (!path.isAbsolute(serverTarget)) {
    throw new Error(`DEVHUB_SERVER_DIR must be absolute (got ${serverTarget})`);
  }
  if (!fs.existsSync(path.join(serverTarget, "core-server.mjs"))) {
    throw new Error(
      `No core-server.mjs at ${serverTarget}. Legacy installed releases cannot be rebuilt in place.`,
    );
  }

  const resolvedServices = servicesTarget ?? resolveServicesTarget(serverTarget);
  if (!fs.existsSync(path.join(resolvedServices, "supervisor.mjs"))) {
    throw new Error(
      `No supervisor.mjs at ${resolvedServices}. Refusing to invent a services tree outside the installed app.`,
    );
  }

  const resourcesTarget = path.resolve(serverTarget, "..", "resources");
  const includeResources = fs.existsSync(path.join(resourcesTarget, "MANIFEST.json"));
  log(`staging dashboard for install into ${serverTarget}`);
  log(`services will install into ${resolvedServices}`);
  let isolated;
  try {
    if (stage) {
      await stage({ build: true });
      if (includeResources) await stageRes();
    } else {
      isolated = await prepare({ includeResources });
      stagedServer = isolated.stagedServer;
      stagedServices = isolated.stagedServices;
      if (includeResources) stagedResources = isolated.stagedResources;
    }

    if (!fs.existsSync(path.join(stagedServer, "core-server.mjs"))) {
      throw new Error(`stage-dashboard produced no core-server.mjs at ${stagedServer}`);
    }
    // Validate both trees before replacing either installed tree.
    if (!fs.existsSync(path.join(stagedServer, "ui", "dist", "index.html"))) {
      throw new Error(`stage-dashboard produced no ui/dist/index.html at ${stagedServer}`);
    }
    if (!fs.existsSync(path.join(stagedServices, "supervisor.mjs"))) {
      throw new Error(`stage-dashboard produced no supervisor.mjs at ${stagedServices}`);
    }
    if (includeResources && (!stagedResources || !fs.existsSync(path.join(stagedResources, "MANIFEST.json")))) {
      throw new Error(`stage-resources produced no MANIFEST.json at ${stagedResources || "the staging directory"}`);
    }

    log(`replacing ${serverTarget}`);
    log(`replacing ${resolvedServices}`);
    const replacements = [
      { from: stagedServer, to: serverTarget, required: ["core-server.mjs", "ui/dist/index.html"] },
      { from: stagedServices, to: resolvedServices, required: ["supervisor.mjs"] },
    ];
    if (includeResources) {
      log(`replacing ${resourcesTarget}`);
      replacements.push({ from: stagedResources, to: resourcesTarget, required: ["MANIFEST.json"] });
    }
    replaceDirectories(replacements, { retainSuccessful: true });

    resealBundle(serverTarget);
    log("done");
  } finally {
    isolated?.dispose();
  }
}

/**
 * The `.app` that owns `serverTarget`, or null when we are restaging the
 * staging dir under `desktop:dev` (nothing to seal there).
 */
export function bundleRootFor(serverTarget) {
  let dir = path.resolve(serverTarget);
  while (dir !== path.dirname(dir)) {
    if (dir.endsWith(".app")) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

function resealBundle(serverTarget) {
  if (process.platform !== "darwin") return;
  const app = bundleRootFor(serverTarget);
  if (!app) return;

  try {
    const { identity, kind } = signBundle(app);
    const verified = verifyBundle(app);
    if (!verified.ok) {
      log(`re-signed ${app} but it still fails verification: ${verified.output}`);
      return;
    }
    log(
      `re-signed ${app} with ${kind === "adhoc" ? "an ad-hoc signature" : identity}` +
        (kind === "adhoc"
          ? " — run `npm run desktop:sign:identity` so macOS stops re-asking for permissions"
          : ""),
    );
  } catch (err) {
    // A rebuild that ships working code but an unsealed bundle is still a
    // usable app; it just re-prompts. Do not fail the rebuild over it.
    log(`could not re-sign ${app}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

if (isEntry(import.meta.url)) {
  rebuildInstalledServer().catch((err) => {
    fail(err instanceof Error ? err.message : String(err));
  });
}
