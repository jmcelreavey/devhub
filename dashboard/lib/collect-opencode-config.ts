/**
 * Reverse-sync for OpenCode model/provider config.
 *
 * Imports the curated keys from the local `~/.config/opencode/opencode.json`
 * back into `opencode/shared/opencode.json`, scrubbing secrets:
 *  - a value equal to a known managed secret (process.env) → its `{env:VAR}`
 *  - a value already `{env:...}` → kept as-is
 *  - a raw secret at a secret-looking path with no known mapping → refused;
 *    the existing repo `{env:...}` ref (if any) is preserved instead.
 *
 * This guarantees a raw API key can never be written into the repo.
 */
import path from "node:path";
import { spawnSync } from "node:child_process";
import { reverseSubstituteRepoRoot } from "./sync-mcp";
import { readJsonObjectFile, writeJsonObjectFile, type Json } from "./json-file";
import {
  CURATED_OPENCODE_KEYS,
  getManagedSecretEnvNames,
  localOpencodeConfigPath,
  readSharedOpencodeConfig,
  sharedOpencodeConfigPath,
} from "./sync-opencode-config";
import { ENV_TOKEN_EXACT, looksLikeRawSecret } from "./opencode-secrets";

function getAtPath(obj: Json | undefined, segs: string[]): Json | undefined {
  let cur: Json | undefined = obj;
  for (const s of segs) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as { [k: string]: Json })[s];
  }
  return cur;
}

interface ScrubCtx {
  /** Resolved secret value -> its {env:NAME} placeholder. */
  valueToToken: Map<string, string>;
  /** Existing repo value, walked in parallel to preserve refs. */
  sharedRoot: Json | undefined;
  refused: string[];
  preservedRefs: number;
}

const SKIP = Symbol("skip-secret");

function scrub(
  value: Json,
  keyName: string,
  segs: string[],
  ctx: ScrubCtx,
): Json | typeof SKIP {
  if (typeof value === "string") {
    if (ENV_TOKEN_EXACT.test(value)) return value;
    const mapped = ctx.valueToToken.get(value);
    if (mapped) return mapped;
    if (looksLikeRawSecret(keyName, value)) {
      const sharedVal = getAtPath(ctx.sharedRoot, segs);
      if (typeof sharedVal === "string" && ENV_TOKEN_EXACT.test(sharedVal)) {
        ctx.preservedRefs++;
        return sharedVal; // keep the repo's {env:...} ref, never import the raw key
      }
      ctx.refused.push(segs.join("."));
      return SKIP;
    }
    return value;
  }
  if (Array.isArray(value)) {
    const out: Json[] = [];
    for (let i = 0; i < value.length; i++) {
      const r = scrub(value[i], keyName, [...segs, String(i)], ctx);
      if (r !== SKIP) out.push(r);
    }
    return out;
  }
  if (value && typeof value === "object") {
    const out: { [k: string]: Json } = {};
    for (const [k, v] of Object.entries(value)) {
      const r = scrub(v as Json, k, [...segs, k], ctx);
      if (r === SKIP) {
        const sharedVal = getAtPath(ctx.sharedRoot, [...segs, k]);
        if (sharedVal !== undefined) out[k] = sharedVal; // preserve repo's existing value
      } else {
        out[k] = r;
      }
    }
    return out;
  }
  return value;
}

export interface CollectOpencodeConfigOptions {
  emit: (line: string) => void;
  repoRoot: string;
  dryRun?: boolean;
}

export async function collectOpencodeConfig(opts: CollectOpencodeConfigOptions): Promise<number> {
  const { emit, repoRoot } = opts;
  const localPath = localOpencodeConfigPath();
  const local = readJsonObjectFile(localPath);
  if (!local) {
    emit(`No readable local OpenCode config at ${localPath} — nothing to collect.`);
    return 0;
  }

  const sharedExisting = (readSharedOpencodeConfig(repoRoot) ?? {}) as Record<string, Json>;

  const valueToToken = new Map<string, string>();
  for (const name of getManagedSecretEnvNames(repoRoot)) {
    const v = process.env[name];
    if (v && v.trim()) valueToToken.set(v, `{env:${name}}`);
  }

  const ctx: ScrubCtx = {
    valueToToken,
    sharedRoot: sharedExisting as Json,
    refused: [],
    preservedRefs: 0,
  };

  const next: Record<string, Json> = { ...sharedExisting };
  const imported: string[] = [];

  for (const key of CURATED_OPENCODE_KEYS) {
    if (!(key in local)) continue;
    ctx.sharedRoot = sharedExisting[key];
    const scrubbed = scrub(local[key], key, [], ctx);
    if (scrubbed === SKIP) {
      emit(`Skipped ${key} — entire value was a raw secret with no known {env:VAR} mapping; keeping existing repo value.`);
      continue;
    }
    next[key] = reverseSubstituteRepoRoot(scrubbed, repoRoot);
    imported.push(key);
  }

  if (imported.length === 0) {
    emit(`No curated keys found in local OpenCode config — nothing to collect.`);
    return 0;
  }

  const rel = path.relative(repoRoot, sharedOpencodeConfigPath(repoRoot));
  if (opts.dryRun) {
    emit(`[DRY-RUN] Would import ${imported.length} key(s) into ${rel}: ${imported.join(", ")}`);
  } else {
    writeJsonObjectFile(sharedOpencodeConfigPath(repoRoot), next);
    spawnSync("git", ["add", rel], { cwd: repoRoot });
    emit(`Imported ${imported.length} key(s) into ${rel}: ${imported.join(", ")}`);
    emit("Staged for commit. Review with: git status");
  }

  if (ctx.preservedRefs > 0) {
    emit(`Preserved ${ctx.preservedRefs} existing {env:...} reference(s) instead of importing resolved values.`);
  }
  if (ctx.refused.length > 0) {
    emit(`WARNING: refused ${ctx.refused.length} raw secret value(s) (no known {env:...} mapping):`);
    for (const p of ctx.refused) emit(`  - ${p}`);
    emit(`  Add an {env:VAR} placeholder for these in ${rel} manually, then add the matching`);
    emit(`  field to your 1Password "devhub" item.`);
  }

  return 0;
}
