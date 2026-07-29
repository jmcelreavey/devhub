import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { withErrorHandler } from "@/lib/api-utils";
import { getCheckoutRoot, isDesktopRuntime } from "@/lib/desktop/runtime-paths";

export const dynamic = "force-dynamic";

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

  // The desktop shell started this server and will stop it again. Its own
  // rebuild is supervised; this one spawns a detached `npm run restart`, which
  // frees port 1337 by killing whoever holds it and outlives the shell — so it
  // can land after a mode switch and kill the server the user moved to.
  if (process.env.DEVHUB_SHELL_SUPERVISED === "1") {
    return {
      available: false,
      mode: process.env.NODE_ENV === "development" ? "dev" : "production",
      checkout: getCheckoutRoot(),
      reason:
        "The desktop app is supervising this server. Use View → Rebuild Dashboard… so the rebuild is stopped and restarted with the app, instead of outliving it.",
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

  const dashboardPkg = path.join(checkout, "dashboard", "package.json");
  if (!fs.existsSync(dashboardPkg)) {
    return {
      available: false,
      mode: "production",
      checkout,
      reason: `Checkout at ${checkout} has no dashboard/package.json.`,
    };
  }

  const mode = process.env.NODE_ENV === "development" ? "dev" : "production";
  return { available: true, mode, checkout };
}

/**
 * Unauthenticated on purpose, and relied upon as such.
 *
 * `proxy.ts` only guards mutating methods, so this GET is the one probe both the
 * Status page and the desktop shell can poll while the server is restarting —
 * `/api/desktop/health` is token-gated and would answer 401 to either of them.
 * It reports capability, never anything a caller could not already infer.
 */
export const GET = withErrorHandler(async () => {
  return NextResponse.json(rebuildCapability());
}, "status/dashboard/rebuild");

/**
 * Kick off `npm run restart` in the checkout's dashboard (production build +
 * relaunch). Detached on purpose — this process is about to be killed.
 *
 * Reopen does NOT rebuild. Auto-rebuild-on-open would cost minutes every launch.
 * This is the explicit escape hatch.
 *
 * No request input reaches the spawn: the command is fixed and the cwd comes
 * from the resolved checkout, so there is nothing here for a caller to inject.
 * The origin guard in `proxy.ts` is what stops a stray local process asking.
 */
export const POST = withErrorHandler(async () => {
  const capability = rebuildCapability();
  if (!capability.available || !capability.checkout) {
    return NextResponse.json(
      { error: capability.reason ?? "Rebuild is not available." },
      { status: 400 },
    );
  }

  const dashboardRoot = path.join(capability.checkout, "dashboard");
  const child = spawn("npm", ["run", "restart"], {
    cwd: dashboardRoot,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, NODE_ENV: "production" },
  });
  child.unref();

  return NextResponse.json({
    ok: true,
    started: true,
    mode: capability.mode,
    checkout: capability.checkout,
    message:
      capability.mode === "dev"
        ? "Production rebuild started. The dev server will stop, build, then come back as next start — give it a couple of minutes."
        : "Rebuild started. This page will drop while Next rebuilds; it should answer again in a couple of minutes.",
  });
}, "status/dashboard/rebuild");
