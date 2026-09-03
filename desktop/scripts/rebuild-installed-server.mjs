#!/usr/bin/env node
/**
 * What "Rebuild Dashboard" in the Tauri menu actually needs to do.
 *
 * Plain `npm run build` only refreshes `dashboard/.next` in the checkout.
 * The packaged app serves `/Applications/DevHub.app/.../Resources/server`
 * (or the staging dir under `desktop:dev`), so that build never reaches the
 * UI the user is staring at — which is how a chip fix can be on HEAD and
 * still invisible after Rebuild.
 *
 * Peer services have the same trap. `stageDashboard()` esbuilds
 * `start-peer-services.ts` into `staging/services/`, but the shell actually
 * runs `Resources/services/start-peer-services.mjs` from the last
 * `desktop:install`. Copying only the Next tree left Chamber/OpenCode on the
 * frozen starter — Rebuild looked successful while OpenChamber 1.11.3 kept
 * winning the port.
 *
 * This script:
 *   1. Stages a standalone Next server and peer services from the checkout
 *   2. Copies the server over DEVHUB_SERVER_DIR
 *   3. Copies peer services over DEVHUB_SERVICES_DIR (or `../services`
 *      next to the server, so an older shell that only passes SERVER_DIR
 *      still restages Chamber/OpenCode)
 *
 *   4. Re-signs the bundle, because steps 2 and 3 just broke its seal
 *
 * That last step is not cosmetic. `Resources/server` and `Resources/services`
 * are sealed by the app's code signature, so rewriting them makes
 * `codesign --verify` fail — and macOS keys TCC grants (Full Disk Access,
 * Local Network, Automation) off that signature. An unsealed bundle is a
 * bundle whose permissions macOS asks for again, every launch.
 *
 * The shell sets DEVHUB_SERVER_DIR from resolve_paths().server_dir, and
 * DEVHUB_SERVICES_DIR from resolve_paths().services_dir when the binary
 * is new enough to pass it.
 */
import fs from "node:fs";
import path from "node:path";
import { stageDashboard } from "./stage-dashboard.mjs";
import { serverDir as stagedServerDir, servicesDir as stagedServicesDir } from "./staging-paths.mjs";
import { signBundle, verifyBundle } from "./codesign-bundle.mjs";

function fail(msg) {
  process.stderr.write(`[rebuild-installed-server] ${msg}\n`);
  process.exit(1);
}

function log(msg) {
  process.stdout.write(`[rebuild-installed-server] ${msg}\n`);
}

/** Replace `to`'s contents with `from` without removing the destination inode. */
export function replaceDirContents(from, to) {
  for (const entry of fs.readdirSync(to)) {
    fs.rmSync(path.join(to, entry), { recursive: true, force: true });
  }
  fs.cpSync(from, to, { recursive: true, dereference: true });
}

/**
 * Packaged layout is `Resources/server` beside `Resources/services`.
 * An older DevHub binary only exports DEVHUB_SERVER_DIR; derive the sibling
 * so View → Rebuild Dashboard still restages the peer starter.
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
  stage = stageDashboard,
} = {}) {
  if (!serverTarget) {
    throw new Error(
      "DEVHUB_SERVER_DIR is required. The desktop shell should pass the packaged server path.",
    );
  }
  if (!path.isAbsolute(serverTarget)) {
    throw new Error(`DEVHUB_SERVER_DIR must be absolute (got ${serverTarget})`);
  }
  if (!fs.existsSync(path.join(serverTarget, "server.js"))) {
    throw new Error(
      `No server.js at ${serverTarget}. Refusing to invent a server tree outside the installed app.`,
    );
  }

  const resolvedServices = servicesTarget ?? resolveServicesTarget(serverTarget);
  if (!fs.existsSync(path.join(resolvedServices, "supervisor.mjs"))) {
    throw new Error(
      `No supervisor.mjs at ${resolvedServices}. Refusing to invent a services tree outside the installed app.`,
    );
  }

  log(`staging dashboard for install into ${serverTarget}`);
  log(`peer services will install into ${resolvedServices}`);
  await stage({ build: true });

  if (!fs.existsSync(path.join(stagedServer, "server.js"))) {
    throw new Error(`stage-dashboard produced no server.js at ${stagedServer}`);
  }
  if (!fs.existsSync(path.join(stagedServices, "start-peer-services.mjs"))) {
    throw new Error(
      `stage-dashboard produced no start-peer-services.mjs at ${stagedServices}`,
    );
  }

  log(`replacing ${serverTarget}`);
  replaceDirContents(stagedServer, serverTarget);
  if (!fs.existsSync(path.join(serverTarget, "server.js"))) {
    throw new Error(`copy failed — ${serverTarget}/server.js missing after sync`);
  }
  if (!fs.existsSync(path.join(serverTarget, ".next", "static"))) {
    throw new Error(`copy failed — ${serverTarget}/.next/static missing after sync`);
  }

  log(`replacing ${resolvedServices}`);
  replaceDirContents(stagedServices, resolvedServices);
  if (!fs.existsSync(path.join(resolvedServices, "start-peer-services.mjs"))) {
    throw new Error(
      `copy failed — ${resolvedServices}/start-peer-services.mjs missing after sync`,
    );
  }
  if (!fs.existsSync(path.join(resolvedServices, "supervisor.mjs"))) {
    throw new Error(`copy failed — ${resolvedServices}/supervisor.mjs missing after sync`);
  }

  resealBundle(serverTarget);

  log("done");
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

if (import.meta.url === `file://${process.argv[1]}`) {
  rebuildInstalledServer().catch((err) => {
    fail(err instanceof Error ? err.message : String(err));
  });
}
