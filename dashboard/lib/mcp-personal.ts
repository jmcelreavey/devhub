import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SharedMcpServer } from "./sync-mcp";

const SERVER_SLUG = /^[a-z0-9][a-z0-9._-]{0,62}$/i;

/** Machine-local MCP catalog (not in git). Synced to all tools like mcp/shared/. */
export function personalMcpDir(home = os.homedir()): string {
  return path.join(home, ".config", "devhub", "mcp-personal");
}

export function isValidPersonalServerName(name: string): boolean {
  return SERVER_SLUG.test(name);
}

export function listPersonalMcpServerNames(home = os.homedir()): string[] {
  const dir = personalMcpDir(home);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => e.name.replace(/\.json$/, ""))
    .filter((n) => isValidPersonalServerName(n))
    .sort();
}

export function readPersonalMcpServer(home: string, name: string): SharedMcpServer | null {
  if (!isValidPersonalServerName(name)) return null;
  const file = path.join(personalMcpDir(home), `${name}.json`);
  const resolved = path.resolve(file);
  if (path.dirname(resolved) !== path.resolve(personalMcpDir(home))) return null;
  if (!fs.existsSync(resolved)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(resolved, "utf-8")) as SharedMcpServer;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    if (typeof raw.command !== "string" && typeof raw.url !== "string") return null;
    return raw;
  } catch {
    return null;
  }
}

export function writePersonalMcpServer(home: string, name: string, server: SharedMcpServer): void {
  if (!isValidPersonalServerName(name)) throw new Error("Invalid server name");
  const dir = personalMcpDir(home);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(server, null, 2) + "\n", "utf-8");
}

export function deletePersonalMcpServer(home: string, name: string): boolean {
  if (!isValidPersonalServerName(name)) return false;
  const file = path.join(personalMcpDir(home), `${name}.json`);
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file, { force: true });
  return true;
}

export function resolvePersonalMcpFile(home: string, name: string): string | null {
  if (!isValidPersonalServerName(name)) return null;
  const file = path.join(personalMcpDir(home), `${name}.json`);
  const resolved = path.resolve(file);
  if (path.dirname(resolved) !== path.resolve(personalMcpDir(home))) return null;
  return resolved;
}
