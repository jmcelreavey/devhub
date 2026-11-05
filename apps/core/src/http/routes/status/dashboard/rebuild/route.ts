import { statusRebuildCapability, statusRebuild } from "../../../../../../../../packages/shared/actions/status";
import fs from "node:fs";
import path from "node:path";
import { withErrorHandler } from "../../../../../lib/api-utils";
import { execExternal } from "../../../../../lib/exec-external";
import { getCheckoutRoot, isDesktopRuntime } from "../../../../../lib/desktop/runtime-paths";


interface RebuildCapability {
  available: boolean;
  mode: "dev" | "production" | "desktop-packaged";
  checkout: string | null;
  reason?: string;
}

function rebuildCapability(): RebuildCapability {
  if (isDesktopRuntime()) {
    return {
      available: false,
      mode: "desktop-packaged",
      checkout: getCheckoutRoot(),
      reason:
        "Packaged DevHub serves a supervised bundle that cannot replace itself. Use Check for Updates, or attach to a checkout's dev server.",
    };
  }

  // dev.mjs supervises core whether or not a desktop shell launched it (systemd
  // sets INVOCATION_ID, which dev.mjs reports as shell-supervised). The rebuild
  // builds in-process and lets that supervisor restart core, so shell
  // supervision is not a reason to refuse. Only an unsupervised core cannot
  // come back after the build.
  if (process.env.DEVHUB_SUPERVISED !== "1") {
    return {
      available: false,
      mode: process.env.NODE_ENV === "development" ? "dev" : "production",
      checkout: getCheckoutRoot(),
      reason: "This core process was not started by the DevHub launcher, so it cannot restart after a build. Start it with `npm run dev` or `npm start`.",
    };
  }

  const checkout = getCheckoutRoot();
  if (!checkout) {
    return {
      available: false,
      mode: "production",
      checkout: null,
      reason:
        "No DevHub checkout is linked. Packaged launches serve a prebuilt bundle — reopen does not rebuild. Use DevHub → Check for Updates…, or View → Attach to Dev Server… against a checkout.",
    };
  }

  const dashboardPkg = path.join(checkout, "apps/ui", "package.json");
  if (!fs.existsSync(dashboardPkg)) {
    return {
      available: false,
      mode: "production",
      checkout,
      reason: `Checkout at ${checkout} has no apps/ui/package.json.`,
    };
  }

  const mode = process.env.NODE_ENV === "development" ? "dev" : "production";
  return { available: true, mode, checkout };
}

/**
 * Unauthenticated on purpose, and relied upon as such.
 *
 * The core server only guards mutating methods, so this GET is the one probe both the
 * Status page and the desktop shell can poll while the server is restarting —
 * `/api/desktop/health` is token-gated and would answer 401 to either of them.
 * It reports capability, never anything a caller could not already infer.
 */
export const GET = withErrorHandler(async () => {
  return await statusRebuildCapability.handler({}, { read: async () => {
  return Response.json(rebuildCapability());
  } }) as Response;
}, "status/dashboard/rebuild");

let building = false;

async function rebuild(checkout: string): Promise<void> {
  const dashboard = path.join(checkout, "apps/ui");
  const temporary = fs.mkdtempSync(path.join(dashboard, ".vite-rebuild-"));
  const built = path.join(temporary, "dist");
  const current = path.join(dashboard, "dist");
  const previous = path.join(temporary, "previous");
  let retain = false;
  try {
    const npm = process.env.npm_execpath;
    const command = npm ? process.execPath : process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "npm";
    const args = npm ? [npm, "run", "build"] : process.platform === "win32" ? ["/d", "/s", "/c", "npm.cmd run build"] : ["run", "build"];
    await execExternal(command, args, { cwd: dashboard, env: { ...process.env, DEVHUB_DIST_DIR: built }, timeoutMs: 600_000, label: "dashboard:build" });
    if (!fs.existsSync(path.join(built, "index.html"))) throw new Error("Vite build did not produce index.html");
    const hadPrevious = fs.existsSync(current);
    if (hadPrevious) fs.renameSync(current, previous);
    try { fs.renameSync(built, current); }
    catch (error) {
      if (hadPrevious) {
        try { fs.renameSync(previous, current); }
        catch (restoreError) { retain = true; throw new Error(`Build replacement failed; previous output retained at ${previous}`, { cause: restoreError }); }
      }
      throw error;
    }
    // The supervisor restarts this core process and keeps the terminal alive.
    setTimeout(() => process.kill(process.pid, "SIGTERM"), 100).unref();
  } finally {
    if (!retain) fs.rmSync(temporary, { recursive: true, force: true });
    building = false;
  }
}

export const POST = withErrorHandler(async () => {
  return await statusRebuild.handler({}, { read: async () => {
    const capability = rebuildCapability();
    if (!capability.available || !capability.checkout) return Response.json({ error: capability.reason ?? "Rebuild is not available." }, { status: 400 });
    if (building) return Response.json({ error: "A rebuild is already running." }, { status: 409 });
    building = true;
    void rebuild(capability.checkout).catch(error => { building = false; console.error("[dashboard:build] rebuild failed", error); });
    return Response.json({ ok: true, started: true, mode: capability.mode, checkout: capability.checkout,
      message: "Build started. The core server will restart when the build is ready." });
  } }) as Response;
}, "status/dashboard/rebuild");
