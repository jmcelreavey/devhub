import fs from "node:fs";
import path from "node:path";
import { getEnvFilePath } from "@/lib/desktop/runtime-paths";

/** Managed keys written by /api/setup/save and calendar OAuth callback. */
export const DASHBOARD_MANAGED_ENV_KEYS = [
  "NOTES_DIR",
  "REPO_ROOT",
  // Path contract (see lib/desktop/runtime-paths.ts). These are managed rather
  // than passthrough so migration can write a user's existing content
  // locations into the new config file instead of relocating their data.
  "DEVHUB_REPOS_DIR",
  "TASKS_DIR",
  "COLLECTIONS_DIR",
  "UPSTARTS_DIR",
  "DOCS_DIR",
  "DEVHUB_IDENTITY_FILE",
  "DEVHUB_BIND_HOST",
  "DEVHUB_LAN_PROXY_HOST",
  "OPENCHAMBER_HOST",
  "OPENCHAMBER_UI_PASSWORD",
  "OPENCODE_BIND_HOST",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN",
  "GOOGLE_OAUTH_REDIRECT_URI",
  "JIRA_DOMAIN",
  "JIRA_EMAIL",
  "JIRA_API_TOKEN",
  "NEXT_PUBLIC_JIRA_DOMAIN",
  "DATADOG_API_KEY",
  "DATADOG_APPLICATION_KEY",
  "DATADOG_APP_KEY",
  "DD_APPLICATION_KEY",
  "DATADOG_ONCALL_SCHEDULE_ID",
  "AI_API_KEY",
  "AI_BASE_URL",
  "AI_MODEL",
  // Last30Days research integration. Secrets can be fetched from the "devhub"
  // 1Password item; local paths stay in .env.local unless DEVHUB_OP_SYNC_LOCAL=1.
  "LAST30DAYS_MEMORY_DIR",
  "LAST30DAYS_SCRIPT",
  "LAST30DAYS_SOURCES",
  "LAST30DAYS_MAX_AGE_HOURS",
  "XAI_API_KEY",
  "XQUIK_API_KEY",
  "BRAVE_SEARCH_API_KEY",
  "PERPLEXITY_API_KEY",
  "OPENROUTER_API_KEY",
  "SCRAPECREATORS_API_KEY",
  "BLUESKY_APP_PASSWORD",
  // Ops integration keys (used by the optional ops plugin: AWS/SSO + repo path)
  "AWS_PROFILE",
  "OKTA_PASSWORD",
  "BI_OPS_USER_EMAIL",
  "CAPI_REPO_PATH",
  // AI provider + agent CLI handoff
  "DEVHUB_AI_PROVIDER",
  "DEVHUB_AGENT_CLI",
  "DEVHUB_AGENT_OPENCODE_MODEL",
  "DEVHUB_AGENT_CURSOR_MODEL",
] as const;


export type DashboardManagedEnvKey = (typeof DASHBOARD_MANAGED_ENV_KEYS)[number];

const MANAGED_SET = new Set<string>(DASHBOARD_MANAGED_ENV_KEYS);

export const DASHBOARD_MANAGED_ENV_KEY_SET = MANAGED_SET;

const GOOGLE_PROCESS_KEYS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN",
  "GOOGLE_OAUTH_REDIRECT_URI",
] as const;

const JIRA_PROCESS_KEYS = ["JIRA_DOMAIN", "JIRA_EMAIL", "JIRA_API_TOKEN"] as const;
const DATADOG_PROCESS_KEYS = ["DATADOG_API_KEY", "DATADOG_APPLICATION_KEY", "DATADOG_APP_KEY", "DD_APPLICATION_KEY", "DATADOG_ONCALL_SCHEDULE_ID"] as const;

const BI_PROCESS_KEYS = ["AWS_PROFILE", "OKTA_PASSWORD", "BI_OPS_USER_EMAIL", "CAPI_REPO_PATH"] as const;

const CHAMBER_PROCESS_KEYS = ["OPENCHAMBER_HOST", "OPENCHAMBER_UI_PASSWORD"] as const;

const AGENT_PROCESS_KEYS = [
  "DEVHUB_AI_PROVIDER",
  "DEVHUB_AGENT_CLI",
  "DEVHUB_AGENT_OPENCODE_MODEL",
  "DEVHUB_AGENT_CURSOR_MODEL",
] as const;


/** Copies the given managed keys from overrides into process.env (deleting when absent/blank). */
function syncProcessEnvFromOverrides(keys: readonly string[], overrides: Map<string, string>): void {
  for (const key of keys) {
    const v = overrides.get(key)?.trim();
    if (v) process.env[key] = v;
    else delete process.env[key];
  }
}

/** Keeps Google Calendar routes working in the same dev process after `.env.local` changes. */
export function syncGoogleProcessEnvFromOverrides(overrides: Map<string, string>): void {
  syncProcessEnvFromOverrides(GOOGLE_PROCESS_KEYS, overrides);
}

export function syncJiraProcessEnvFromOverrides(overrides: Map<string, string>): void {
  syncProcessEnvFromOverrides(JIRA_PROCESS_KEYS, overrides);
}

export function syncDatadogProcessEnvFromOverrides(overrides: Map<string, string>): void {
  syncProcessEnvFromOverrides(DATADOG_PROCESS_KEYS, overrides);
}

export function syncBiProcessEnvFromOverrides(overrides: Map<string, string>): void {
  syncProcessEnvFromOverrides(BI_PROCESS_KEYS, overrides);
}

/**
 * Keeps the OpenChamber bind host + UI password live in this process after a
 * save, so the in-app "Restart" button (which spawns the daemon from
 * process.env) picks up changes without a full relaunch.
 */
export function syncChamberProcessEnvFromOverrides(overrides: Map<string, string>): void {
  syncProcessEnvFromOverrides(CHAMBER_PROCESS_KEYS, overrides);
}

/** Keeps agent CLI handoff settings live in this process after a save. */
export function syncAgentProcessEnvFromOverrides(overrides: Map<string, string>): void {
  syncProcessEnvFromOverrides(AGENT_PROCESS_KEYS, overrides);
}

/**
 * The config file this process reads and writes.
 *
 * `process.cwd()/.env.local` only makes sense when the process was started
 * from `dashboard/`. The installed app starts from a bundle, so the path comes
 * from `DEVHUB_ENV_FILE` instead — which also means user config survives an
 * update that replaces every packaged file.
 */
export function getDashboardEnvLocalPath(): string {
  return getEnvFilePath();
}

/**
 * Create the config file's parent at `0700`.
 *
 * This file holds Jira tokens, Datadog keys, Google refresh tokens, and an
 * OpenChamber UI password in plaintext. On a multi-user machine the default
 * umask would leave both the directory and the file world-readable, which for
 * this content is not an acceptable default — so both are tightened
 * explicitly rather than relying on whatever the user's umask happens to be.
 *
 * Best-effort by design: `chmod` is meaningless on Windows and on some network
 * filesystems, and failing to save a user's settings because the mode could
 * not be set would be a worse outcome than a permissive mode.
 */
function ensureEnvFileParent(envPath: string): void {
  const dir = path.dirname(envPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700); // mkdirSync's mode is ignored when the dir exists
  } catch {
    /* non-POSIX filesystem */
  }
}

function parseEnvFile(filePath: string): Map<string, string> {
  const result = new Map<string, string>();
  if (!fs.existsSync(filePath)) return result;
  const raw = fs.readFileSync(filePath, "utf-8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key) result.set(key, value);
  }
  return result;
}

export function readDashboardEnvLocalFile(): {
  overrides: Map<string, string>;
  passthrough: string[];
} {
  const envPath = getDashboardEnvLocalPath();
  const overrides = new Map<string, string>();
  const passthrough: string[] = [];
  if (!fs.existsSync(envPath)) return { overrides, passthrough };

  const existing = fs.readFileSync(envPath, "utf-8");
  for (const line of existing.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    const key = eqIdx < 0 ? "" : trimmed.slice(0, eqIdx).trim();
    const value = eqIdx < 0 ? "" : trimmed.slice(eqIdx + 1);
    if (MANAGED_SET.has(key)) {
      overrides.set(key, value);
    } else {
      passthrough.push(line);
    }
  }

  const parentEnvPath = path.resolve(path.dirname(envPath), "..", ".env.local");
  if (parentEnvPath !== envPath && fs.existsSync(parentEnvPath)) {
    const parentVars = parseEnvFile(parentEnvPath);
    for (const [key, value] of parentVars) {
      if (MANAGED_SET.has(key) && !overrides.has(key)) {
        overrides.set(key, value);
      }
    }
  }

  return { overrides, passthrough };
}

/** Persists merged managed keys plus passthrough comments/extra vars. */
export function writeDashboardEnvLocalFile(
  overrides: Map<string, string>,
  passthrough: string[],
): void {
  const rendered = [
    ...DASHBOARD_MANAGED_ENV_KEYS.filter((k) => overrides.has(k)).map((k) => `${k}=${overrides.get(k)}`),
    ...passthrough,
  ];
  const envPath = getDashboardEnvLocalPath();
  ensureEnvFileParent(envPath);
  fs.writeFileSync(envPath, rendered.join("\n") + "\n", "utf-8");
  try {
    fs.chmodSync(envPath, 0o600);
  } catch {
    /* non-POSIX filesystem */
  }
}

/**
 * Prefer `.env.local` over `process.env` so values apply immediately after a save
 * or OAuth callback without relying on Next restarting the worker.
 */
export function resolveEnvValue(envKey: string, fileOverrides: Map<string, string>): string | undefined {
  const fileVal = fileOverrides.get(envKey)?.trim();
  if (fileVal) return fileVal;
  const p = process.env[envKey]?.trim();
  if (p) return p;
  return undefined;
}

export function patchDashboardEnvLocalFile(mutator: (overrides: Map<string, string>) => void): void {
  const { overrides, passthrough } = readDashboardEnvLocalFile();
  mutator(overrides);
  writeDashboardEnvLocalFile(overrides, passthrough);
}
