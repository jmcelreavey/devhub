import { execFile as _execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { patchDashboardEnvLocalFile } from "../lib/dashboard-env-local";
import { augmentedPathEnv } from "../lib/process-env";
import { getManagedSecretEnvNames } from "../lib/sync-opencode-config";
import { loadEnvLocalIntoProcessIfUnset } from "./load-env-local-into-process";

const execFile = promisify(_execFile);

// Local paths/preferences rather than secrets. Excluded from 1Password sync by
// default so a stored value (especially an absolute path from another machine)
// can't clobber a fresh machine. Set DEVHUB_OP_SYNC_LOCAL=1 to opt in and pull
// these from the "devhub" item too — handy when every machine shares the same
// layout. Either way they're only fetched when still unset locally, so an
// existing machine's value is never overwritten.
const LOCAL_ONLY_KEYS = new Set<string>([
  "NOTES_DIR",
  "DOCS_DIR",
  "REPO_ROOT",
  "DEVHUB_BIND_HOST",
  "OPENCHAMBER_HOST",
  "OPENCODE_BIND_HOST",
  "GOOGLE_OAUTH_REDIRECT_URI",
  "NEXT_PUBLIC_JIRA_DOMAIN",
  "AWS_PROFILE",
  "BI_OPS_USER_EMAIL",
  "CAPI_REPO_PATH",
  "AI_BASE_URL",
  "AI_MODEL",
]);

/** When set, the LOCAL_ONLY_KEYS above also sync from 1Password (when unset). */
function syncLocalKeysEnabled(): boolean {
  return process.env.DEVHUB_OP_SYNC_LOCAL === "1";
}

function markerPath(envDir: string): string {
  return path.join(envDir, ".env.op-synced");
}

function isSynced(envDir: string): boolean {
  if (process.env.DEVHUB_OP_CACHE === "0") return false;
  if (process.env.DEVHUB_OP_REFRESH === "1") return false;
  return fs.existsSync(markerPath(envDir));
}

function writeMarker(envDir: string): void {
  if (process.env.DEVHUB_OP_CACHE === "0") return;
  fs.writeFileSync(markerPath(envDir), new Date().toISOString() + "\n", "utf-8");
}

function repoRootFor(envDir: string): string {
  const root = process.env.REPO_ROOT;
  return root ? path.resolve(root) : path.resolve(envDir, "..");
}

function missableSecretKeys(repoRoot: string): string[] {
  const includeLocal = syncLocalKeysEnabled();
  return getManagedSecretEnvNames(repoRoot).filter((k) => {
    if (!includeLocal && LOCAL_ONLY_KEYS.has(k)) return false;
    return !(process.env[k] ?? "").trim();
  });
}

async function runOp(args: string[]): Promise<string> {
  const { stdout } = await execFile("op", args, {
    env: augmentedPathEnv(),
    timeout: 15_000,
  });
  return stdout.trim();
}

async function probeOp(): Promise<{ installed: boolean; signedIn: boolean }> {
  let installed = false;
  let signedIn = false;
  try {
    await runOp(["--version"]);
    installed = true;
  } catch {
    return { installed, signedIn };
  }
  try {
    await runOp(["whoami"]);
    signedIn = true;
  } catch {
    // not signed in
  }
  return { installed, signedIn };
}

export interface OnePasswordStatus {
  installed: boolean;
  signedIn: boolean;
  itemFound: boolean;
}

export async function checkOnePasswordStatus(
  item?: string,
  vault?: string,
): Promise<OnePasswordStatus> {
  const resolvedItem = item ?? process.env.DEVHUB_OP_ITEM ?? "devhub";
  const { installed, signedIn } = await probeOp();
  if (!installed || !signedIn) return { installed, signedIn, itemFound: false };

  let itemFound = false;
  try {
    const vaultArgs = vault ? ["--vault", vault] : [];
    await runOp(["item", "get", resolvedItem, "--format", "json", ...vaultArgs]);
    itemFound = true;
  } catch {
    // item not found or ambiguous — itemFound stays false
  }

  return { installed, signedIn, itemFound };
}

interface OpField {
  label?: string;
  value?: string;
}

interface OpItem {
  fields?: OpField[];
}

/**
 * Loads `.env.local` / `.env` (file values always win), then falls back to
 * 1Password for any managed secret keys that are still unset. Fetched values
 * are written back to `.env.local` and a marker file prevents re-fetching on
 * subsequent startups. Set `DEVHUB_OP_REFRESH=1` to force a re-fetch.
 *
 * Configuration (all optional, settable in .env.local):
 *   DEVHUB_OP_ITEM   — 1Password item title (default: "devhub")
 *   DEVHUB_OP_VAULT  — vault to search (default: all vaults)
 *   DEVHUB_OP_REFRESH — set to "1" to bypass the sync marker and re-fetch
 *   DEVHUB_OP_CACHE  — set to "0" to avoid writing fetched secrets to .env.local
 *   DEVHUB_OP_SYNC_LOCAL — set to "1" to also pull local-only keys (paths,
 *                    ports, prefs) from 1Password when unset; off by default
 */
export async function loadEnvWithOnePasswordFallback(envDir: string): Promise<void> {
  loadEnvLocalIntoProcessIfUnset(envDir);

  const missing = missableSecretKeys(repoRootFor(envDir));
  if (missing.length === 0) return;

  if (isSynced(envDir)) return;

  const opItem = process.env.DEVHUB_OP_ITEM ?? "devhub";
  const opVault = process.env.DEVHUB_OP_VAULT;

  const { installed, signedIn } = await probeOp();

  if (!installed) {
    process.stdout.write(
      `  · 1Password CLI not found — install it to auto-fill ${missing.length} secret(s):\n` +
        `    https://developer.1password.com/docs/cli/get-started/\n` +
        `    Then create a "${opItem}" item in 1Password with fields named after your env vars.\n`,
    );
    writeMarker(envDir);
    return;
  }

  if (!signedIn) {
    process.stdout.write(`  · 1Password CLI found but not signed in. Run \`op signin\` to auto-fill secrets.\n`);
    writeMarker(envDir);
    return;
  }

  let raw: string;
  try {
    const vaultArgs = opVault ? ["--vault", opVault] : [];
    raw = await runOp(["item", "get", opItem, "--format", "json", ...vaultArgs]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("isn't an item") || msg.includes("not found")) {
      process.stdout.write(
        `  · 1Password: no item named "${opItem}" found.\n` +
          `    Create one with fields named after your env vars (e.g. JIRA_API_TOKEN).\n` +
          `    Use DEVHUB_OP_ITEM to change the item name, DEVHUB_OP_VAULT to pin a vault.\n`,
      );
    } else if (msg.includes("More than one item") || msg.includes("more than one")) {
      process.stdout.write(
        `  · 1Password: multiple "${opItem}" items found — set DEVHUB_OP_VAULT=<vault> to disambiguate.\n`,
      );
    } else {
      process.stdout.write(`  · 1Password: could not fetch "${opItem}": ${msg}\n`);
    }
    writeMarker(envDir);
    return;
  }

  let item: OpItem;
  try {
    item = JSON.parse(raw) as OpItem;
  } catch {
    process.stdout.write(`  · 1Password: unexpected response format from "${opItem}"\n`);
    writeMarker(envDir);
    return;
  }

  const fieldMap = new Map<string, string>();
  for (const field of item.fields ?? []) {
    if (field.label && field.value !== undefined) {
      fieldMap.set(field.label, field.value);
    }
  }

  const fetched: string[] = [];
  if (process.env.DEVHUB_OP_CACHE === "0") {
    for (const key of missing) {
      const value = fieldMap.get(key);
      if (value !== undefined && value.trim()) {
        process.env[key] = value;
        fetched.push(key);
      }
    }
  } else {
    patchDashboardEnvLocalFile((overrides) => {
      for (const key of missing) {
        const value = fieldMap.get(key);
        if (value !== undefined && value.trim()) {
          process.env[key] = value;
          overrides.set(key, value);
          fetched.push(key);
        }
      }
    });
  }

  if (fetched.length > 0) {
    const cacheStatus = process.env.DEVHUB_OP_CACHE === "0" ? "without caching to .env.local" : "and cached to .env.local";
    process.stdout.write(`  · 1Password: loaded ${fetched.length} secret(s) from "${opItem}" ${cacheStatus}\n`);
  }

  // Anything still unset means the "devhub" item has no field for it. Call this
  // out explicitly — otherwise the marker below silences the next startup and
  // the gap looks like a DevHub bug rather than a missing 1Password field.
  const stillMissing = missing.filter((key) => !(process.env[key] ?? "").trim());
  if (stillMissing.length > 0) {
    process.stdout.write(
      `  · 1Password: "${opItem}" has no field for ${stillMissing.length} key(s): ${stillMissing.join(", ")}.\n` +
        `    Add a field for each (label = env var name) to auto-fill them, then re-run with DEVHUB_OP_REFRESH=1.\n`,
    );
  }

  writeMarker(envDir);
}
