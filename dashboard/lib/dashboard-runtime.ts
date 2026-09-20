/**
 * Where the dashboard is, and what it can do, for anything outside the process.
 *
 * The MCP server used to assume `http://localhost:1337`. That is right until it
 * isn't: a checkout running on a free port is invisible, and — worse — a
 * *packaged* build sitting on 1337 answers, but with an older route table. The
 * failure mode is a flat `404 Not Found` from a tool the user has every reason
 * to think is broken, when the truth is "you are talking to a different DevHub
 * than the one you just built".
 *
 * So the server advertises itself on boot: base URL, pid, and the API features
 * this build carries. A client can then pick the right instance and, when the
 * one it finds is too old, say so in those words.
 *
 * The file lives in `~/.config/devhub/` beside `plugins.json` — machine-local
 * by definition, and never inside a repo where it could be committed.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Capability tags, not a version number.
 *
 * A consumer wants to know "can this instance serve `/api/db`", and asking that
 * directly survives the routes being backported, reordered or shipped in a
 * different release than expected. A semver comparison would make every client
 * carry a table of which version gained which route.
 */
export const DASHBOARD_FEATURES = ["db", "notes", "repos", "scripts", "terminal"] as const;
export type DashboardFeature = (typeof DASHBOARD_FEATURES)[number];

export interface DashboardRuntimeInfo {
  baseUrl: string;
  port: number;
  pid: number;
  /** Epoch ms, so a stale file from a crashed process is recognisable. */
  startedAt: number;
  /** "checkout" or "packaged" — which one you are talking to matters. */
  kind: "checkout" | "packaged";
  features: DashboardFeature[];
}

export function dashboardRuntimePath(home: string = os.homedir()): string {
  return path.join(home, ".config", "devhub", "dashboard.json");
}

function currentPort(): number {
  return Number(process.env.PORT?.trim()) || 1337;
}

/**
 * A packaged app runs from inside the bundle; a checkout does not.
 *
 * Reported rather than inferred by the client, because "which DevHub am I
 * talking to" is the question that makes a stale-route 404 legible.
 */
function currentKind(): DashboardRuntimeInfo["kind"] {
  if (process.env.DEVHUB_DESKTOP === "1") return "packaged";
  return process.cwd().includes(".app/Contents/") ? "packaged" : "checkout";
}

export function buildRuntimeInfo(): DashboardRuntimeInfo {
  const port = currentPort();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    pid: process.pid,
    startedAt: Date.now(),
    kind: currentKind(),
    features: [...DASHBOARD_FEATURES],
  };
}

/**
 * Advertise this instance.
 *
 * Last writer wins, deliberately: the dashboard you started most recently is
 * the one you are working in, and it is the one an agent should reach. Two
 * instances racing is not a case worth arbitrating — the second one is the
 * answer.
 */
export function writeDashboardRuntime(file = dashboardRuntimePath()): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(buildRuntimeInfo(), null, 2)}\n`);
  } catch {
    // Advertising is a convenience. Failing to write it must never stop the
    // server from starting — the client still has DEVHUB_BASE_URL and the
    // default port.
  }
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

/**
 * Is this process the dashboard agents are pointed at? Background work that
 * hands off to the terminal dock (auto PR review) must run there: proposals
 * live in one server's memory, and a second dashboard nobody has open queues
 * work that never starts. No file, or a dead advertiser, means nobody else owns it.
 */
export function isAdvertisedDashboard(
  file = dashboardRuntimePath(),
  pid: number = process.pid,
): boolean {
  const info = readDashboardRuntime(file);
  if (!info || info.pid === pid) return true;
  return !isRuntimeAlive(info);
}

/** Is the advertised process still alive? A crashed server leaves its file behind. */
export function isRuntimeAlive(info: DashboardRuntimeInfo): boolean {
  if (!info.pid) return false;
  try {
    // Signal 0 checks for existence without delivering anything.
    process.kill(info.pid, 0);
    return true;
  } catch {
    return false;
  }
}
