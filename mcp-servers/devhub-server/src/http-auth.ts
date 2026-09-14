/**
 * Access control for the HTTP MCP entry (http.ts).
 *
 * Binding to 127.0.0.1 is not a boundary on its own: any local process can
 * reach loopback, and any web page the user visits can make the browser send
 * requests to it. So every request needs the bearer token, and Host/Origin must
 * be loopback (or explicitly allowed) to shut out DNS rebinding.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_MCP_HTTP_PORT = 1340;
const MIN_TOKEN_LENGTH = 32;
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function mcpHttpTokenFile(env: NodeJS.ProcessEnv = process.env): string {
  return env.DEVHUB_MCP_HTTP_TOKEN_FILE?.trim() || path.join(os.homedir(), ".config", "devhub", "mcp-http-token");
}

/**
 * `DEVHUB_MCP_HTTP_TOKEN`, else the persisted token, else a new random one
 * written 0600 — persisted so client configs keep working across restarts.
 */
export function resolveMcpHttpToken(env: NodeJS.ProcessEnv = process.env): {
  token: string;
  source: "env" | "file" | "generated";
  file: string;
} {
  const file = mcpHttpTokenFile(env);
  const fromEnv = env.DEVHUB_MCP_HTTP_TOKEN?.trim();
  if (fromEnv) {
    if (fromEnv.length < MIN_TOKEN_LENGTH) {
      throw new Error(`DEVHUB_MCP_HTTP_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`);
    }
    return { token: fromEnv, source: "env", file };
  }
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing.length >= MIN_TOKEN_LENGTH) return { token: existing, source: "file", file };
  } catch {
    /* generate below */
  }
  const token = randomBytes(32).toString("base64url");
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return { token, source: "generated", file };
}

/** Constant-time `Authorization: Bearer <token>` check. */
export function bearerMatches(header: string | undefined, token: string): boolean {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  if (!match?.[1]) return false;
  const given = Buffer.from(match[1]);
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** A rebinding page that resolves to 127.0.0.1 still sends its own name as Host. */
export function isAllowedHost(host: string | undefined, extraHosts: readonly string[] = []): boolean {
  if (!host) return false;
  const name = host.replace(/:\d+$/, "").toLowerCase();
  return LOOPBACK_HOSTS.has(name) || extraHosts.includes(name);
}

/** Native MCP clients usually send no Origin; a browser's must be loopback too. */
export function isAllowedOrigin(origin: string | undefined, extraHosts: readonly string[] = []): boolean {
  if (!origin) return true;
  try {
    return isAllowedHost(new URL(origin).host, extraHosts);
  } catch {
    return false;
  }
}

export function parseAllowedHosts(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}
