import fs from "node:fs";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { DEV_SERVICES } from "./dev-services";
import { findOpenChamberBin } from "./openchamber-command";
import { resolveOpenCodeBinary, resolveOpenCodeBindHost } from "./opencode-command";
import { findInstalledApp } from "./launch-desktop";

function commandOnPath(cmd: string): boolean {
  const which = process.platform === "win32" ? "where" : "which";
  return spawnSync(which, [cmd], { stdio: "ignore" }).status === 0;
}

/**
 * True when a system OpenChamber is available. Detection (PATH, the node bin
 * dir, and a login shell) lives in `findOpenChamberBin` so it's robust to a GUI
 * launch where the server's PATH omits the install dir. DevHub no longer vendors
 * OpenChamber, so when none is found the Chamber nav/iframe is simply hidden.
 */
export function isOpenChamberConfigured(): boolean {
  return findOpenChamberBin() !== null;
}

export function isOpenCodeConfigured(): boolean {
  const bin = resolveOpenCodeBinary();
  if (bin !== "opencode") return fs.existsSync(bin);
  return commandOnPath("opencode");
}

/**
 * True when Claude is available locally — either the `claude` CLI is on PATH
 * or the native Claude desktop app is installed. Gates the Claude sidebar item
 * so it only appears for people who actually have it.
 */
export function isClaudeConfigured(): boolean {
  if (commandOnPath("claude")) return true;
  return findInstalledApp("Claude", "claude") !== null;
}

export function checkServicePort(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://${host}:${port}`, { timeout: 2_000 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

export async function isPeerServiceActive(serviceId: "openchamber" | "opencode"): Promise<boolean> {
  const svc = DEV_SERVICES.find((s) => s.id === serviceId);
  if (!svc) return false;
  const port = Number.parseInt(process.env[svc.portEnvKey] ?? String(svc.defaultPort), 10);
  const bind =
    serviceId === "opencode"
      ? resolveOpenCodeBindHost()
      : (process.env[svc.hostEnvKey] ?? "0.0.0.0");
  const probeHost = bind === "0.0.0.0" ? "127.0.0.1" : bind;
  return checkServicePort(port, probeHost);
}

/** True when the companion binary exists or the dev peer is already listening. */
export async function getPeerServiceGateStatus(): Promise<{
  chamber: boolean;
  opencode: boolean;
  claude: boolean;
}> {
  const [chamberActive, opencodeActive] = await Promise.all([
    isPeerServiceActive("openchamber"),
    isPeerServiceActive("opencode"),
  ]);
  const opencode = isOpenCodeConfigured() || opencodeActive;
  // Chamber depends on OpenCode — hide it unless a system OpenChamber exists
  // and OpenCode is available too.
  const chamber = chamberActive || (isOpenChamberConfigured() && opencode);
  const claude = isClaudeConfigured();
  return { chamber, opencode, claude };
}
