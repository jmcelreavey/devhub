import fs from "node:fs";
import path from "node:path";

/** Trims `process.env[key]`; returns `fallback` when missing or empty after trim. */
export function envTrimOrDefault(key: string, fallback: string): string {
  return (process.env[key] ?? "").trim() || fallback;
}

/**
 * Loads `dashboard/.env.local` then `.env` into `process.env`, only for keys
 * that are not already set in the parent environment.
 *
 * Used by dev/start wrappers so `DEVHUB_BIND_HOST` / `OPENCHAMBER_HOST` from
 * Setup apply before `next dev` / OpenChamber spawn (npm script expansion does
 * not read `.env.local`).
 */
export function loadEnvLocalIntoProcessIfUnset(envDir: string): void {
  for (const name of [".env.local", ".env"] as const) {
    const file = path.join(envDir, name);
    if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
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
