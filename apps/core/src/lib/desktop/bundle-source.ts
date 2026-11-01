import fs from "node:fs";
import path from "node:path";
import { execExternal } from "../exec-external";
import { getAppDataDir, getCheckoutRoot } from "./runtime-paths";
import { PACKAGED_STALE_REASON } from "../../../../../packages/shared/ui-lib/desktop/packaged-checkout-copy";
import { parseNulSeparatedPaths, touchesBuildPaths } from "../content/sync-paths";

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

export async function readCheckoutHeadCommit(checkout: string): Promise<string | null> {
  try {
    const { stdout } = await execExternal("git", ["rev-parse", "HEAD"], {
      cwd: checkout,
      timeoutMs: 5_000,
      label: "packaged-checkout:head",
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Files that differ between two commits, or null when git cannot say (e.g. an unknown commit). */
async function changedPathsBetween(checkout: string, base: string, head: string): Promise<string[] | null> {
  try {
    const { stdout } = await execExternal("git", ["diff", "--name-only", "--no-renames", "-z", base, head], {
      cwd: checkout,
      timeoutMs: 5_000,
      label: "packaged-checkout:diff",
    });
    return parseNulSeparatedPaths(stdout);
  } catch {
    return null;
  }
}

/**
 * Whether the installed app should nudge Rebuild Dashboard or Attach to Dev Server.
 *
 * Only meaningful in packaged runtime with a linked checkout and a bundle marker.
 * Missing `bundle-source.json` (pre-marker installs) stays quiet — we cannot know.
 */
export async function getPackagedCheckoutStatus(): Promise<PackagedCheckoutStatus> {
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
  const checkoutCommit = await readCheckoutHeadCommit(checkout);
  base.bundleCommit = bundleCommit;
  base.checkoutCommit = checkoutCommit;

  let stale = Boolean(bundleCommit && checkoutCommit && bundleCommit !== checkoutCommit);
  if (stale) {
    // A content-only sync (notes, tasks, docs) moves HEAD without changing what a rebuild
    // produces. If git can't tell what changed, keep the nudge.
    const changed = await changedPathsBetween(checkout, bundleCommit!, checkoutCommit!);
    if (changed && !touchesBuildPaths(changed)) stale = false;
  }
  base.stale = stale;
  if (stale) base.reason = PACKAGED_STALE_REASON;

  return base;
}
