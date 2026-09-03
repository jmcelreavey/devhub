/**
 * Finding the dashboard this MCP server should talk to.
 *
 * The old rule was `DEVHUB_BASE_URL || http://localhost:1337`, which is right
 * until it isn't. Two ways it goes wrong, and the second is the nasty one:
 *
 * 1. A checkout running on a free port is simply not found.
 * 2. A *packaged* build on 1337 answers — with an older route table. Tools
 *    added since that build 404, and a bare "404 Not Found" reads as a broken
 *    tool rather than "you are talking to a different DevHub".
 *
 * The dashboard now advertises itself in `~/.config/devhub/dashboard.json` with
 * its URL and a feature list. This reads that, prefers a live process, and
 * keeps the old rule as the fallback so nothing regresses when the file is
 * missing.
 *
 * `DEVHUB_BASE_URL` still wins outright: an explicit setting is a decision, and
 * discovery should never override one.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface DashboardRuntimeInfo {
  baseUrl: string;
  port: number;
  pid: number;
  startedAt: number;
  kind: "checkout" | "packaged";
  features: string[];
}

export interface ResolvedDashboard {
  baseUrl: string;
  /** How we picked it, for diagnostics. */
  source: "env" | "advertised" | "default";
  /** Null when nothing was advertised — features are then unknown, not absent. */
  runtime: DashboardRuntimeInfo | null;
}

export function dashboardRuntimePath(home: string = os.homedir()): string {
  return path.join(home, ".config", "devhub", "dashboard.json");
}

export function readDashboardRuntime(file = dashboardRuntimePath()): DashboardRuntimeInfo | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as DashboardRuntimeInfo;
    if (typeof parsed?.baseUrl !== "string" || !parsed.baseUrl) return null;
    return { ...parsed, features: Array.isArray(parsed.features) ? parsed.features : [] };
  } catch {
    return null;
  }
}

/** Is the advertised process still alive? A crashed server leaves its file behind. */
export function isRuntimeAlive(info: DashboardRuntimeInfo): boolean {
  if (!info.pid) return false;
  try {
    process.kill(info.pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function resolveDashboard(
  env: NodeJS.ProcessEnv = process.env,
  file = dashboardRuntimePath(),
): ResolvedDashboard {
  const runtime = readDashboardRuntime(file);

  const explicit = env.DEVHUB_BASE_URL?.trim();
  if (explicit) return { baseUrl: explicit, source: "env", runtime };

  // A dead advertisement is worse than none: it points confidently at a port
  // nothing is listening on.
  if (runtime && isRuntimeAlive(runtime)) {
    return { baseUrl: runtime.baseUrl, source: "advertised", runtime };
  }

  return { baseUrl: "http://localhost:1337", source: "default", runtime: null };
}

/**
 * Explain a 404 that is really a version mismatch.
 *
 * Returns null when the feature is present (or unknown), so callers can pass
 * the original error through untouched — inventing an explanation for an
 * ordinary 404 would be worse than saying nothing.
 */
export function explainMissingFeature(
  resolved: ResolvedDashboard,
  feature: string,
): string | null {
  const runtime = resolved.runtime;
  if (!runtime) return null;
  if (runtime.features.includes(feature)) return null;

  const which =
    runtime.kind === "packaged"
      ? "the packaged DevHub.app"
      : `a DevHub checkout (pid ${runtime.pid})`;

  return (
    `The dashboard at ${resolved.baseUrl} is ${which} and does not serve '${feature}' routes — ` +
    `it predates them. Restart the DevHub you built these from, or set DEVHUB_BASE_URL to its port.`
  );
}
