import fs from "node:fs";
import path from "node:path";

/** Managed keys written by /api/setup/save and calendar OAuth callback. */
export const DASHBOARD_MANAGED_ENV_KEYS = [
  "NOTES_DIR",
  "REPO_ROOT",
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
  // Agent CLI handoff (which CLI runs one-shot jobs + model overrides)
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

export function getDashboardEnvLocalPath(): string {
  return path.resolve(process.cwd(), ".env.local");
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
  fs.writeFileSync(getDashboardEnvLocalPath(), rendered.join("\n") + "\n", "utf-8");
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
