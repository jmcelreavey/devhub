import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DEV_SERVICES } from "./dev-services";
import { resolveOpenChamberCommand } from "./openchamber-command";
import { resolveOpenCodeBinary, resolveOpenCodeBindHost } from "./opencode-command";

function commandOnPath(cmd: string): boolean {
  const which = process.platform === "win32" ? "where" : "which";
  return spawnSync(which, [cmd], { stdio: "ignore" }).status === 0;
}

export function isOpenChamberConfigured(dashboardDir = process.cwd()): boolean {
  const configured = process.env.OPENCHAMBER_BIN?.trim();
  if (configured) return fs.existsSync(configured);

  const local = path.resolve(dashboardDir, "node_modules", "@openchamber", "web", "bin", "cli.js");
  if (fs.existsSync(local)) return true;

  const { source } = resolveOpenChamberCommand();
  if (source !== "PATH lookup") return true;
  return commandOnPath("openchamber");
}

export function isOpenCodeConfigured(): boolean {
  const bin = resolveOpenCodeBinary();
  if (bin !== "opencode") return fs.existsSync(bin);
  return commandOnPath("opencode");
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
export async function getPeerServiceGateStatus(
  dashboardDir = process.cwd(),
): Promise<{ chamber: boolean; opencode: boolean }> {
  const [chamberActive, opencodeActive] = await Promise.all([
    isPeerServiceActive("openchamber"),
    isPeerServiceActive("opencode"),
  ]);
  return {
    chamber: isOpenChamberConfigured(dashboardDir) || chamberActive,
    opencode: isOpenCodeConfigured() || opencodeActive,
  };
}
