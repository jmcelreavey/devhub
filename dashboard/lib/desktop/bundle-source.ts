import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getAppDataDir, getCheckoutRoot } from "@/lib/desktop/runtime-paths";
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

export interface BundleSource {
  commit: string | null;
  sourceCommit: string | null;
  builtAtMs: number | null;
}

/** Commit, private source SHA, and build time recorded beside server.js. */
export function readBundleSource(serverDir: string = resolveServerDir() ?? ""): BundleSource {
  const empty: BundleSource = { commit: null, sourceCommit: null, builtAtMs: null };
  if (!serverDir) return empty;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(serverDir, "bundle-source.json"), "utf8")) as {
      commit?: unknown;
      sourceCommit?: unknown;
      builtAt?: unknown;
    };
    const commit = typeof parsed.commit === "string" ? parsed.commit.trim() : "";
    const sourceCommit = typeof parsed.sourceCommit === "string" ? parsed.sourceCommit.trim() : "";
    const builtAtMs = typeof parsed.builtAt === "string" ? Date.parse(parsed.builtAt) : Number.NaN;
    return {
      commit: commit || null,
      sourceCommit: sourceCommit || null,
      builtAtMs: Number.isFinite(builtAtMs) ? builtAtMs : null,
    };
  } catch {
    return empty;
  }
}

/** Git commit recorded at staging time (`bundle-source.json` beside `server.js`). */
export function readBundleSourceCommit(serverDir: string = resolveServerDir() ?? ""): string | null {
  return readBundleSource(serverDir).commit;
}

function isReleaseBundle(): boolean {
  const server = resolveServerDir();
  if (!server) return false;
  try {
    const marker: unknown = JSON.parse(fs.readFileSync(path.join(server, "bundle-source.json"), "utf8"));
    return typeof marker === "object" && marker !== null && "release" in marker && marker.release === true;
  } catch {
    return false;
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

  // Content commits are independent of app releases. Developer rebuild advice
  // is only useful for a locally built app linked to its source checkout.
  if (isReleaseBundle() || fs.existsSync(path.join(getAppDataDir(), "content-repo-path.txt"))) return base;

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
