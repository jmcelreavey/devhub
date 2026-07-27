#!/usr/bin/env node
/**
 * Build the dashboard for the desktop bundle and stage exactly what runs.
 *
 * Two outputs:
 *
 * 1. `staging/server/` — Next's standalone output, which is a real Node server
 *    plus a *traced* subset of `node_modules`. Tracing is the whole reason this
 *    is a Phase 0 risk: if it misses a dynamically-required file, the app
 *    builds, signs, ships, and then 500s on somebody else's laptop. The
 *    assertions at the bottom exist to turn that into a build failure.
 *
 * 2. `staging/services/` — the peer entrypoints, bundled to plain JS by
 *    esbuild. The dev-time versions are TypeScript run through `tsx` and
 *    orchestrated by `concurrently`; shipping either would mean shipping a
 *    toolchain, and a toolchain is a thing that can be missing.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  dashboardDir,
  desktopDir,
  repoRoot,
  serverDir,
  servicesDir,
  stagingDir,
} from "./staging-paths.mjs";

const require = createRequire(import.meta.url);

function log(msg) {
  process.stdout.write(`[stage-dashboard] ${msg}\n`);
}

function copyDir(from, to) {
  if (!fs.existsSync(from)) return false;
  fs.cpSync(from, to, { recursive: true, dereference: true });
  return true;
}

/**
 * An empty content tree to build against.
 *
 * Next prerenders static routes at build time, using whatever data the build
 * machine has. On this repo — the private mirror, where notes and tasks are
 * committed next to the code — that meant `/notes` was prerendered with the
 * developer's real note titles and shipped as HTML inside the installer. The
 * first bundle built from this pipeline had exactly that in
 * `.next/server/app/notes.html`.
 *
 * Pointing every content directory at an empty scratch tree fixes it at the
 * source, and the prerendered output it produces — an empty state — is also
 * the correct first paint for a fresh install. A new user opening the app
 * should not briefly see somebody else's notes before hydration replaces them.
 */
function emptyContentTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-build-content-"));
  for (const sub of ["notes", "tasks", "collections", "upstarts", "docs"]) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }
  return dir;
}

function buildNext() {
  log("building Next (standalone)");
  const content = emptyContentTree();
  try {
    execFileSync(
      process.execPath,
      [require.resolve("next/dist/bin/next", { paths: [dashboardDir] }), "build", "--webpack"],
      {
        cwd: dashboardDir,
        stdio: "inherit",
        env: {
          ...process.env,
          DEVHUB_DESKTOP_BUILD: "1",
          // tsc already ran in `verify`; Next's second full-program pass is the
          // one that OOMs CI at the default heap size.
          DEVHUB_SKIP_NEXT_TYPECHECK: "true",
          NODE_ENV: undefined,
          NODE_OPTIONS:
            "--max-old-space-size=4096 --no-deprecation --disable-warning=ExperimentalWarning",
          // Prerender against nothing. See emptyContentTree().
          NOTES_DIR: path.join(content, "notes"),
          TASKS_DIR: path.join(content, "tasks"),
          COLLECTIONS_DIR: path.join(content, "collections"),
          UPSTARTS_DIR: path.join(content, "upstarts"),
          DOCS_DIR: path.join(content, "docs"),
          DEVHUB_REPOS_DIR: path.join(content, "repos"),
        },
      },
    );
  } finally {
    fs.rmSync(content, { recursive: true, force: true });
  }
}

function stageServer() {
  const standalone = path.join(dashboardDir, ".next", "standalone");
  if (!fs.existsSync(standalone)) {
    throw new Error(
      `Next produced no standalone output at ${standalone}. ` +
        `output: "standalone" is gated on DEVHUB_DESKTOP_BUILD=1 — see dashboard/next.config.ts.`,
    );
  }

  fs.rmSync(serverDir, { recursive: true, force: true });
  fs.mkdirSync(serverDir, { recursive: true });

  /**
   * `outputFileTracingRoot` is the repo root, so standalone nests the output
   * under `dashboard/`. Flatten it: the sidecar's cwd has to be the directory
   * containing `server.js`, because that file resolves `.next` and `public`
   * relative to cwd.
   */
  const nested = path.join(standalone, "dashboard");
  const root = fs.existsSync(path.join(nested, "server.js")) ? nested : standalone;
  copyDir(root, serverDir);

  // Traced output deliberately excludes these two — they are served, not
  // required, so nothing in the graph points at them.
  if (!copyDir(path.join(dashboardDir, ".next", "static"), path.join(serverDir, ".next", "static"))) {
    throw new Error("Missing .next/static — the app would render unstyled with no client JS.");
  }
  copyDir(path.join(dashboardDir, "public"), path.join(serverDir, "public"));

  // Hoisted node_modules from the repo root, if the layout put them there.
  const hoisted = path.join(standalone, "node_modules");
  if (root === nested && fs.existsSync(hoisted)) {
    fs.cpSync(hoisted, path.join(serverDir, "node_modules"), {
      recursive: true,
      dereference: true,
      force: false,
      errorOnExist: false,
    });
  }

  stripEnvFiles();
}

/**
 * Delete every `.env*` file Next copied into the standalone output.
 *
 * Next deliberately bundles `.env`, `.env.local`, and friends into
 * `.next/standalone` and `server.js` loads them at boot. That is correct for a
 * server deployment and catastrophic here: in this repo `dashboard/.env.local`
 * holds the developer's real Jira token, Datadog keys, Google refresh token,
 * OpenChamber password, and AI API key. Left alone, they are copied verbatim
 * into a signed public installer.
 *
 * This was not theoretical — the first bundle built from this pipeline
 * contained the file. `verify-staging.mjs` caught it before signing, which is
 * what that gate is for, but the right fix is not to produce it in the first
 * place.
 *
 * Removing them is safe because the installed app never wants them: all
 * configuration comes from `DEVHUB_ENV_FILE` in the user's own app-data
 * directory, loaded by the supervisor before anything starts.
 */
function stripEnvFiles() {
  const removed = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue; // never contains our env
        walk(full);
      } else if (/^\.env(\..*)?$/.test(entry.name)) {
        fs.rmSync(full, { force: true });
        removed.push(path.relative(serverDir, full));
      }
    }
  };
  walk(serverDir);
  if (removed.length > 0) {
    log(`removed ${removed.length} env file(s) Next bundled: ${removed.join(", ")}`);
  }
}

/**
 * `node-pty` is a native module: a prebuilt `.node` for one platform and ABI.
 *
 * esbuild cannot bundle it and Next's tracer does not see it (the PTY server is
 * not part of the Next graph). It is copied wholesale and marked external, and
 * `stage-all` asserts the binary is present — a missing `.node` is a terminal
 * that fails at runtime with a message about a module, which is exactly the
 * kind of failure that should be a build error instead.
 */
function stageNodePty({ platform = os.platform(), arch = os.arch() } = {}) {
  const src = path.join(dashboardDir, "node_modules", "node-pty");
  if (!fs.existsSync(src)) {
    throw new Error(`node-pty is not installed at ${src} — run npm install in dashboard/ first.`);
  }
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
      fs.cpSync(from, path.join(dest, entry), { recursive: true, dereference: true });
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
  fs.cpSync(from, to, { recursive: true, dereference: true });

  const natives = fs.readdirSync(to).filter((f) => f.endsWith(".node"));
  if (natives.length === 0) {
    throw new Error(`Staged node-pty prebuild ${prebuiltDir} contains no .node binding.`);
  }
  log(`staged node-pty for ${prebuiltDir} (${natives.join(", ")})`);
}

async function stageServices() {
  const esbuild = require(require.resolve("esbuild", { paths: [dashboardDir] }));
  fs.rmSync(servicesDir, { recursive: true, force: true });
  fs.mkdirSync(servicesDir, { recursive: true });

  // CJS: node-pty is a CommonJS native addon, and an ESM bundle would need a
  // createRequire dance for no benefit in a file nothing else imports.
  await esbuild.build({
    entryPoints: [path.join(dashboardDir, "scripts", "terminal-pty-server.ts")],
    outfile: path.join(servicesDir, "terminal-pty-server.cjs"),
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    external: ["node-pty"],
    logLevel: "warning",
  });
  log("bundled terminal-pty-server.cjs");

  /**
   * The peer services — OpenChamber (1336) and OpenCode (1338).
   *
   * Originally omitted, which meant the installed app served a dashboard whose
   * Chamber and OpenCode pages were permanently empty: the ports were never
   * listening because nothing started them. The dev script ran them through
   * `concurrently`; the packaged app has to start them itself.
   *
   * Bundled with the same externals as the PTY server. Both peers are optional
   * at runtime — they shell out to binaries the user may not have — so the
   * supervisor treats a failure to start as a warning, not a fatal error.
   */
  await esbuild.build({
    entryPoints: [path.join(dashboardDir, "scripts", "start-peer-services.ts")],
    outfile: path.join(servicesDir, "start-peer-services.mjs"),
    bundle: true,
    platform: "node",
    target: "node22",
    // ESM, unlike the PTY server. The source uses `import.meta.url`, and
    // esbuild's CJS output turns that into `undefined` rather than failing the
    // build — so the bundle compiled cleanly and then died at startup with
    // "path argument must be of type string. Received undefined". Nothing about
    // that error points at the output format, which is why it is spelled out
    // here. The PTY server stays CJS because node-pty is a CJS native addon.
    format: "esm",
    external: ["node-pty"],
    logLevel: "warning",
  });
  log("bundled start-peer-services.mjs");

  stageNodePty();

  fs.copyFileSync(
    path.join(desktopDir, "sidecar", "supervisor.mjs"),
    path.join(servicesDir, "supervisor.mjs"),
  );
  log("staged supervisor.mjs");
}

/**
 * Prove the staged tree can actually start.
 *
 * Everything asserted here has a failure mode that is invisible until launch:
 * a server with no static assets renders unstyled, a missing `.next/server`
 * 500s on the first request, an absent `node-pty` binding kills the terminal.
 * Better a red build than a signed installer that does this to a stranger.
 */
function assertStaged() {
  const required = [
    [path.join(serverDir, "server.js"), "Next standalone entrypoint"],
    [path.join(serverDir, ".next", "static"), "client assets"],
    [path.join(serverDir, ".next", "server"), "server chunks"],
    [path.join(servicesDir, "supervisor.mjs"), "sidecar supervisor"],
    [path.join(servicesDir, "terminal-pty-server.cjs"), "terminal server"],
    [
      path.join(servicesDir, "node_modules", "node-pty", "prebuilds", `${os.platform()}-${os.arch()}`),
      "node-pty native binding",
    ],
  ];
  const missing = required.filter(([p]) => !fs.existsSync(p));
  if (missing.length > 0) {
    throw new Error(
      "Staging is incomplete:\n" +
        missing.map(([p, what]) => `  - ${what}: ${path.relative(repoRoot, p)}`).join("\n"),
    );
  }

  // Belt and braces on stripEnvFiles(). A signed installer containing somebody's
  // API tokens cannot be recalled, so this is a hard failure at the point of
  // staging as well as a check in the pre-signing gate.
  const strays = fs
    .readdirSync(serverDir)
    .filter((name) => /^\.env(\..*)?$/.test(name));
  if (strays.length > 0) {
    throw new Error(
      `Environment files survived staging: ${strays.join(", ")}. These contain live credentials and must never be bundled.`,
    );
  }
}

export async function stageDashboard({ build = true } = {}) {
  fs.mkdirSync(stagingDir, { recursive: true });
  if (build) buildNext();
  stageServer();
  await stageServices();
  assertStaged();
  log(`staged to ${path.relative(repoRoot, stagingDir)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  stageDashboard({ build: !process.argv.includes("--no-build") }).catch((err) => {
    process.stderr.write(`[stage-dashboard] ${err.message}\n`);
    process.exit(1);
  });
}
