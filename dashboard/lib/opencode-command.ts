import fs from "node:fs";
import path from "node:path";
import { augmentedPathEnv } from "./process-env";

export function getOpenCodeEnv(): NodeJS.ProcessEnv {
  return augmentedPathEnv();
}

export function resolveOpenCodeBinary(): string {
  const configured = process.env.DEVHUB_OPENCODE_BINARY?.trim();
  if (configured) return configured;

  const userBin = path.join(process.env.HOME ?? "", ".opencode", "bin", "opencode");
  if (fs.existsSync(userBin)) return userBin;

  return "opencode";
}

/** Bind address for `opencode serve --hostname` (legacy: OPENCODE_HOST). */
export function resolveOpenCodeBindHost(): string {
  const bind = process.env.OPENCODE_BIND_HOST?.trim();
  if (bind) return bind;
  const legacy = process.env.OPENCODE_HOST?.trim();
  if (legacy && !legacy.includes("://")) return legacy;
  return "0.0.0.0";
}

export function resolveOpenCodePort(): number {
  const parsed = Number.parseInt(process.env.OPENCODE_PORT ?? "1338", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1338;
}
