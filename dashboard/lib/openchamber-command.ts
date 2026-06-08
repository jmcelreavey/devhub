import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolveOpenCodePort } from "./opencode-command";

const NPM_PREFIX_POLLUTED_KEYS = [
  "npm_config_prefix",
  "npm_config_global_prefix",
  "npm_config_local_prefix",
];

export function cleanOpenChamberEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of NPM_PREFIX_POLLUTED_KEYS) {
    delete env[key];
  }
  const userOpencode = path.join(process.env.HOME ?? "", ".opencode", "bin", "opencode");
  if (!process.env.DEVHUB_OPENCODE_BINARY && fs.existsSync(userOpencode)) {
    env.OPENCODE_BINARY = userOpencode;
  } else if (process.env.DEVHUB_OPENCODE_BINARY) {
    env.OPENCODE_BINARY = process.env.DEVHUB_OPENCODE_BINARY;
  }

  // Use DevHub's shared opencode serve (start-opencode.ts) instead of embedding another.
  env.OPENCODE_PORT = String(resolveOpenCodePort());
  env.OPENCODE_SKIP_START = "true";
  // OPENCODE_HOST is a full URL in OpenChamber; DevHub bind address lives in OPENCODE_BIND_HOST.
  delete env.OPENCODE_HOST;

  return env;
}

export function resolveOpenChamberCommand(): { cmd: string; argsPrefix: string[]; source: string } {
  const configured = process.env.OPENCHAMBER_BIN?.trim();
  if (configured) return { cmd: configured, argsPrefix: [], source: "OPENCHAMBER_BIN" };

  // Prefer the repo's pinned copy: package.json is the source of truth, so a stale
  // global install can never shadow the version DevHub ships with.
  const local = path.resolve(process.cwd(), "node_modules", "@openchamber", "web", "bin", "cli.js");
  if (fs.existsSync(local)) {
    return { cmd: process.execPath, argsPrefix: [local], source: "local @openchamber/web" };
  }

  const cleanEnv = cleanOpenChamberEnv();
  const npmPrefix = spawnSync("npm", ["prefix", "-g"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: cleanEnv,
  });
  const globalPrefix = npmPrefix.status === 0 ? npmPrefix.stdout.trim() : "";
  const globalBin = globalPrefix
    ? path.join(globalPrefix, process.platform === "win32" ? "openchamber.cmd" : "bin/openchamber")
    : "";
  if (globalBin && fs.existsSync(globalBin)) {
    return { cmd: globalBin, argsPrefix: [], source: "global openchamber fallback" };
  }

  return { cmd: "openchamber", argsPrefix: [], source: "PATH lookup" };
}
