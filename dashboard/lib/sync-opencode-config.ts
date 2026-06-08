/**
 * In-process sync for OpenCode model/provider config.
 *
 * Source of truth is `opencode/shared/opencode.json` at the repo root. Only a
 * curated allowlist of keys is synced into the user's real
 * `~/.config/opencode/opencode.json` — everything else in that file (the `mcp`
 * block, `$schema`, agents, anything OpenCode writes itself) is left
 * untouched, so OpenCode keeps auto-updating its model catalogue.
 *
 * Secrets never live in the repo. Provider keys are stored as OpenCode-native
 * `{env:VAR}` placeholders; on sync they are resolved from `process.env`
 * (populated by the op-secrets 1Password fallback layer) and the concrete
 * value is written only into the local file. An unresolved `{env:VAR}` is
 * still valid OpenCode config, so the degraded path stays clean.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DASHBOARD_MANAGED_ENV_KEYS } from "./dashboard-env-local";
import { readJsonObjectFile, writeJsonObjectFile, type Json } from "./json-file";
import { mcpToolById, substituteRepoRoot } from "./sync-mcp";

/** The only top-level opencode.json keys this sync owns. */
export const CURATED_OPENCODE_KEYS = ["model", "small_model", "provider", "theme"] as const;

const ENV_TOKEN = /\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g;

export function sharedOpencodeConfigPath(repoRoot: string): string {
  return path.join(repoRoot, "opencode", "shared", "opencode.json");
}

/** Local target — reuse the OpenCode config path already defined for MCP sync. */
export function localOpencodeConfigPath(): string {
  const target = mcpToolById("opencode");
  if (!target) throw new Error("OpenCode MCP target missing from MCP_TOOL_TARGETS");
  return target.configPath(os.homedir());
}

export function readSharedOpencodeConfig(repoRoot: string): Record<string, Json> | null {
  return readJsonObjectFile(sharedOpencodeConfigPath(repoRoot));
}

/** Collect every NAME referenced via `{env:NAME}` anywhere in a JSON value. */
function collectEnvNames(value: Json, into: Set<string>): void {
  if (typeof value === "string") {
    for (const m of value.matchAll(ENV_TOKEN)) into.add(m[1]);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectEnvNames(v, into);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectEnvNames(v as Json, into);
  }
}

/** Env-var names the shared opencode config references via `{env:NAME}`. */
export function listOpencodeSecretEnvNames(repoRoot: string): string[] {
  const shared = readSharedOpencodeConfig(repoRoot);
  if (!shared) return [];
  const names = new Set<string>();
  for (const key of CURATED_OPENCODE_KEYS) {
    if (key in shared) collectEnvNames(shared[key], names);
  }
  return [...names].sort();
}

/**
 * Single source of "which secret env vars DevHub manages": the static
 * dashboard list plus any `{env:VAR}` discovered in the shared opencode
 * config. op-secrets consumes this so new providers need zero code changes.
 */
export function getManagedSecretEnvNames(repoRoot: string): string[] {
  const names = new Set<string>(DASHBOARD_MANAGED_ENV_KEYS);
  for (const n of listOpencodeSecretEnvNames(repoRoot)) names.add(n);
  return [...names];
}

/** Replace `{env:NAME}` with process.env[NAME]; record names that are unset. */
function resolveEnvTokens(value: Json, unresolved: Set<string>): Json {
  if (typeof value === "string") {
    return value.replace(ENV_TOKEN, (token, name: string) => {
      const v = process.env[name];
      if (v && v.trim()) return v;
      unresolved.add(name);
      return token;
    });
  }
  if (Array.isArray(value)) return value.map((v) => resolveEnvTokens(v, unresolved));
  if (value && typeof value === "object") {
    const out: { [key: string]: Json } = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveEnvTokens(v as Json, unresolved);
    return out;
  }
  return value;
}

export interface SyncOpencodeConfigOptions {
  emit: (line: string) => void;
  repoRoot: string;
  dryRun?: boolean;
}

export async function syncOpencodeConfig(opts: SyncOpencodeConfigOptions): Promise<number> {
  const { emit, repoRoot } = opts;
  const sharedPath = sharedOpencodeConfigPath(repoRoot);

  const shared = readSharedOpencodeConfig(repoRoot);
  if (shared === null) {
    // Distinguish "absent" (nothing to do) from "present but broken".
    if (!fs.existsSync(sharedPath)) {
      emit(`No ${path.relative(repoRoot, sharedPath)} — nothing to sync.`);
      return 0;
    }
    emit(`ERROR: ${path.relative(repoRoot, sharedPath)} is not valid JSON (object expected).`);
    return 1;
  }

  const localPath = localOpencodeConfigPath();
  const existing = readJsonObjectFile(localPath) ?? {};
  const merged: Record<string, Json> = { ...existing };

  const unresolved = new Set<string>();
  const written: string[] = [];

  for (const key of CURATED_OPENCODE_KEYS) {
    if (!(key in shared)) continue;
    const substituted = substituteRepoRoot(shared[key], repoRoot);
    merged[key] = resolveEnvTokens(substituted, unresolved);
    written.push(key);
  }

  if (written.length === 0) {
    emit(`No curated keys (${CURATED_OPENCODE_KEYS.join(", ")}) present in shared config.`);
    return 0;
  }

  emit(`OpenCode config target: ${localPath}`);
  if (opts.dryRun) {
    emit(`[DRY-RUN] Would write ${written.length} key(s): ${written.join(", ")} (mcp + other keys preserved).`);
  } else {
    writeJsonObjectFile(localPath, merged);
    emit(`Synced ${written.length} key(s): ${written.join(", ")}. Preserved mcp + non-curated keys.`);
  }

  if (unresolved.size > 0) {
    const names = [...unresolved].sort();
    emit(`WARNING: ${names.length} secret env var(s) unresolved — left as {env:...} placeholders:`);
    emit(`  ${names.join(", ")}`);
    emit(`  Fix: add matching fields to your 1Password "devhub" item (or set them in .env.local),`);
    emit(`  ensure \`op signin\` is done, then re-run Sync OpenCode.`);
  }

  return 0;
}
