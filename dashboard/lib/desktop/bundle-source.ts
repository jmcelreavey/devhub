import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getCheckoutRoot } from "@/lib/desktop/runtime-paths";
import { PACKAGED_STALE_REASON } from "@/lib/desktop/packaged-checkout-copy";

export interface PackagedCheckoutStatus {
  /** True when the sidecar sets DEVHUB_PACKAGED_RUNTIME=1 (installed .app bundle). */
  packagedRuntime: boolean;
  hasCheckout: boolean;
  checkout: string | null;
  bundleCommit: string | null;
  checkoutCommit: string | null;
  /** Linked checkout HEAD differs from the commit baked into the running bundle. */
  stale: boolean;
  reason?: string;
}

/** True when this Node process serves the frozen Resources/server bundle. */
export function isPackagedRuntime(): boolean {
  return process.env.DEVHUB_PACKAGED_RUNTIME === "1";
}

function resolveServerDir(): string | null {
  const fromEnv = process.env.DEVHUB_SERVER_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  if (isPackagedRuntime()) return process.cwd();
  return null;
}

/** Git commit recorded at staging time (`bundle-source.json` beside `server.js`). */
export function readBundleSourceCommit(serverDir: string = resolveServerDir() ?? ""): string | null {
  if (!serverDir) return null;
  try {
    const raw = fs.readFileSync(path.join(serverDir, "bundle-source.json"), "utf8");
    const parsed = JSON.parse(raw) as { commit?: unknown };
    const commit = typeof parsed.commit === "string" ? parsed.commit.trim() : "";
    return commit || null;
  } catch {
    return null;
  }
}

export function readCheckoutHeadCommit(checkout: string): string | null {
  const res = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: checkout,
    encoding: "utf8",
  });
  if (res.status !== 0) return null;
  const commit = res.stdout.trim();
  return commit || null;
}

/**
 * Whether the installed app should nudge Rebuild Dashboard or Attach to Dev Server.
 *
 * Only meaningful in packaged runtime with a linked checkout and a bundle marker.
 * Missing `bundle-source.json` (pre-marker installs) stays quiet — we cannot know.
 */
export function getPackagedCheckoutStatus(): PackagedCheckoutStatus {
  const checkout = getCheckoutRoot();
  const base: PackagedCheckoutStatus = {
    packagedRuntime: isPackagedRuntime(),
    hasCheckout: checkout !== null,
    checkout,
    bundleCommit: null,
    checkoutCommit: null,
    stale: false,
  };

  if (!base.packagedRuntime || !checkout) return base;

  const bundleCommit = readBundleSourceCommit();
  const checkoutCommit = readCheckoutHeadCommit(checkout);
  base.bundleCommit = bundleCommit;
  base.checkoutCommit = checkoutCommit;

  const stale = Boolean(
    bundleCommit && checkoutCommit && bundleCommit !== checkoutCommit,
  );
  base.stale = stale;
  if (stale) base.reason = PACKAGED_STALE_REASON;

  return base;
}
