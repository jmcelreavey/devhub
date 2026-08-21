import fs from "node:fs";
import path from "node:path";
import { augmentedPathEnv } from "@/lib/process-env";

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
