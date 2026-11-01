import fs from "node:fs";
import path from "node:path";

/** Trims `process.env[key]`; returns `fallback` when missing or empty after trim. */
export function envTrimOrDefault(key: string, fallback: string): string {
  return (process.env[key] ?? "").trim() || fallback;
}

export function resolveDashboardBindHost(raw = envTrimOrDefault("DEVHUB_BIND_HOST", "127.0.0.1")): string {
  const host = raw.trim() || "127.0.0.1";
  return ["auto", "lan"].includes(host.toLowerCase()) ? "127.0.0.1" : host;
}


/**
 * Loads `apps/ui/.env.local` then `.env` into `process.env`, only for keys
 * that are not already set in the parent environment.
 *
 * Used by the supervisor and core before the server starts.
 */
export function loadEnvLocalIntoProcessIfUnset(
  envDir: string,
  options: { mode?: "development"; keys?: readonly string[] } = {},
): void {
  const files = options.mode === "development"
    ? [".env.development.local", ".env.local", ".env.development", ".env"]
    : [".env.local", ".env"];
  for (const name of files) {
    const file = path.join(envDir, name);
    if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      if (options.keys && !options.keys.includes(key)) continue;
      let value = trimmed.slice(idx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}
