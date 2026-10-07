import fs from "node:fs";
import path from "node:path";
import { readDashboardEnvLocalFile } from "@/lib/dashboard-env-local";
import { getAppDataDir, isDesktopRuntime } from "@/lib/desktop/runtime-paths";
import { SetupProgressSchema, type SetupProgress } from "./progress";

function stateFile(): string {
  return path.join(getAppDataDir(), "config", "first-run.json");
}

/**
 * Settings that only exist once somebody has chosen where their content lives
 * or connected an integration. The Paseo password is deliberately absent: a
 * managed install writes it on a profile that has never seen the wizard.
 */
const CONFIGURED_ENV_KEYS = [
  "NOTES_DIR", "REPO_ROOT", "DEVHUB_REPOS_DIR", "DEVHUB_CONTENT_ROOT",
  "JIRA_API_TOKEN", "DATADOG_API_KEY", "GOOGLE_REFRESH_TOKEN", "AI_API_KEY", "DEVHUB_AI_PROVIDER",
] as const;

function hasLinkedContent(): boolean {
  return ["content-repo-path.txt", "repo-path.txt"].some((name) => {
    try {
      return fs.readFileSync(path.join(getAppDataDir(), name), "utf8").trim() !== "";
    } catch {
      return false;
    }
  });
}

/**
 * A profile that predates `first-run.json` but is already set up: a linked
 * checkout or content repo, or saved paths/integration keys. Sending it back
 * to the wizard after an app upgrade is the bug this guards against.
 */
function isProfileConfigured(): boolean {
  if (hasLinkedContent()) return true;
  const { overrides } = readDashboardEnvLocalFile();
  return CONFIGURED_ENV_KEYS.some((key) => overrides.get(key)?.trim());
}

/** The stored record, or `null` when no build has written one yet. */
function readStoredProgress(): SetupProgress | null {
  try {
    return SetupProgressSchema.parse(JSON.parse(fs.readFileSync(stateFile(), "utf8")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code !== "ENOENT") throw error;
    return null;
  }
}

export function readSetupProgress(): SetupProgress {
  const stored = readStoredProgress();
  if (stored) return stored;
  // No state file: either a genuinely new desktop profile, or an install that
  // was configured by an older build which never wrote one. Record the latter
  // once so it is not re-evaluated (and never re-opens the wizard).
  if (isDesktopRuntime() && isProfileConfigured()) {
    return saveSetupProgress({ completed: true, currentStep: "done" });
  }
  return SetupProgressSchema.parse({});
}

export function saveSetupProgress(patch: Partial<Omit<SetupProgress, "completedAt">>): SetupProgress {
  const current = readStoredProgress() ?? SetupProgressSchema.parse({});
  const next = SetupProgressSchema.parse({
    ...current,
    ...patch,
    completedAt: patch.completed && !current.completed ? new Date().toISOString() : current.completedAt,
  });
  const file = stateFile();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
  return next;
}
