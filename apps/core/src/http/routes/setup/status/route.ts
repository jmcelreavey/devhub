import fs from "node:fs";
import { setupStatus } from "../../../../../../../packages/shared/actions/setup";
import path from "node:path";
import { readDashboardEnvLocalFile, resolveEnvValue } from "../../../../lib/dashboard-env-local";
import { getAppDataDir, getCheckoutRoot, getReposDir, hasCheckout, isDesktopRuntime } from "../../../../lib/desktop/runtime-paths";
import { setupCoreDefaults } from "../../../../lib/setup/core-defaults";
import { readDatadogSetupStatus } from "../../../../lib/setup/datadog-setup-status";
import { resolveTypesafeApiKey } from "../../../../lib/qa/credentials";
import { getResolvedGoogleCalendarEnv } from "../../../../lib/google-calendar";
import { isGithubCliAuthenticated } from "../../../../lib/repos/index";
import { ghAuthLoginCommand } from "../../../../lib/plugins/source";
import { detectInfrastructurePresence } from "../../../../lib/infrastructure-presence";
import { getPeerServiceGateStatus, isOpenCodeConfigured } from "../../../../lib/peer-service-availability";
import { isCursorAgentInstalled, readAgentCliSettings } from "../../../../lib/agent/cli-env";
import {
  isAntigravityCliInstalled,
  isChatgptCliInstalled,
  readConfiguredAiProvider,
} from "../../../../lib/ai/preference";
import { isNotesAiConfigured } from "../../../../lib/notes-ai/config";
import { readSetupProgress } from "../../../../lib/setup/first-run";
import { isOptionalIntegrationAvailable } from "../../../../lib/plugin-integration-hooks";





/**
 * How many direct children of the code folder are git repositories.
 *
 * Setup shows this as "Found 12 Git repositories" — a plain sentence that tells
 * the user they picked the right folder far better than echoing a path back at
 * them does. One level deep only: a recursive walk of somebody's home directory
 * on a setup page load is not worth the number.
 */
function countGitRepos(dir: string): number {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .filter((e) => fs.existsSync(path.join(dir, e.name, ".git"))).length;
  } catch {
    return 0;
  }
}

export async function GET() {
  return await setupStatus.handler({}, { execute: readStatus }) as Response;
}

async function readStatus() {
  const datadogSetup = await readDatadogSetupStatus();
  const { overrides } = readDashboardEnvLocalFile();

  // Suggested paths. In a checkout the dashboard runs from devhub/dashboard, so
  // cwd's parent is the repo; the installed app runs from inside its bundle and
  // must not suggest storing anything there (see setupCoreDefaults).
  const { repoRoot: defaultRepoRoot, notesDir: defaultNotesDir } = setupCoreDefaults({
    desktop: isDesktopRuntime(),
    checkoutRoot: getCheckoutRoot(),
    configuredRepoRoot: resolveEnvValue("REPO_ROOT", overrides),
    cwd: process.cwd(),
    appDataDir: getAppDataDir(),
  });

  const google = getResolvedGoogleCalendarEnv();
  const calendar = !!(google.clientId && google.clientSecret && google.refreshToken);
  /**
   * When Calendar OAuth is not finished, echo saved Web client creds so /setup can rehydrate the form.
   * Local-only dashboard; values already live in `apps/ui/.env.local`.
   */
  const calendarClientIdPreview =
    google.clientId && google.clientSecret && !calendar ? google.clientId : null;
  const calendarClientSecretPreview =
    google.clientId && google.clientSecret && !calendar ? google.clientSecret : null;

  const jiraDomain = resolveEnvValue("JIRA_DOMAIN", overrides) ?? "";
  const jiraEmail = resolveEnvValue("JIRA_EMAIL", overrides) ?? "";
  const jiraApiToken = resolveEnvValue("JIRA_API_TOKEN", overrides);
  const jira = !!(jiraDomain && jiraEmail && jiraApiToken);

  const effectiveNotesDir = resolveEnvValue("NOTES_DIR", overrides) ?? defaultNotesDir;
  /**
   * The code folder. `getReposDir()` already applies the whole precedence
   * chain (explicit → parent-of-checkout → ~/Developer), so status reports
   * what discovery will actually scan rather than re-deriving it and drifting.
   */
  const effectiveReposDir = getReposDir();
  const repoCount = countGitRepos(effectiveReposDir);
  const core = !!(effectiveNotesDir && effectiveReposDir);
  const github = await isGithubCliAuthenticated();
  const datadog = datadogSetup.available && datadogSetup.configured;

  const infrastructure = detectInfrastructurePresence((key) => resolveEnvValue(key, overrides));

  // OPENCHAMBER_UI_PASSWORD is the legacy name; Paseo still falls back to it.
  const hasAgentsPassword =
    !!resolveEnvValue("DEVHUB_PASEO_PASSWORD", overrides) || !!resolveEnvValue("OPENCHAMBER_UI_PASSWORD", overrides);

  const peerServices = await getPeerServiceGateStatus();
  let typesafeSource: "setup" | "env" | "repo-env" | null = null;
  try { typesafeSource = resolveTypesafeApiKey()?.source ?? null; } catch { /* unreadable repo .env counts as not configured */ }

  return Response.json({
    core,
    github,
    calendar,
    jira,
    datadog,
    datadogAvailable: datadogSetup.available,
    datadogStatusError: datadogSetup.failed,
    slackAvailable: isOptionalIntegrationAvailable(),
    typesafe: typesafeSource !== null,
    typesafeVars: { source: typesafeSource },
    infra: infrastructure.infra,
    opencode: peerServices.opencode,
    claude: peerServices.claude,
    cursor: peerServices.cursor,
    chatgpt: peerServices.chatgpt,
    antigravity: peerServices.antigravity,
    completed: readSetupProgress().completed,
    hasAgentsPassword,
    envPath: ".env.local",
    /**
     * Desktop mode changes what setup should *ask*, not just how it looks: no
     * Node requirement (it is bundled), no "install the app" step, and the
     * checkout path is hidden unless one genuinely exists.
     */
    desktop: isDesktopRuntime(),
    hasCheckout: hasCheckout(),
    coreVars: {
      repoRoot: resolveEnvValue("REPO_ROOT", overrides) ?? "",
      notesDir: resolveEnvValue("NOTES_DIR", overrides) ?? "",
      reposDir: resolveEnvValue("DEVHUB_REPOS_DIR", overrides) ?? "",
    },
    coreDefaults: {
      repoRoot: defaultRepoRoot,
      notesDir: defaultNotesDir,
      reposDir: effectiveReposDir,
    },
    reposDirInfo: {
      resolved: effectiveReposDir,
      exists: fs.existsSync(effectiveReposDir),
      repoCount,
    },
    calendarVars: {
      hasClientId: !!google.clientId,
      hasClientSecret: !!google.clientSecret,
      hasRefreshToken: !!google.refreshToken,
    },
    calendarClientIdPreview,
    calendarClientSecretPreview,
    jiraVars: {
      hasDomain: !!jiraDomain,
      hasEmail: !!jiraEmail,
      hasApiToken: !!jiraApiToken,
      domain: jiraDomain,
      email: jiraEmail,
    },
    githubVars: {
      authenticated: github,
      ghCommand: ghAuthLoginCommand(),
    },
    datadogVars: datadogSetup.fields,
    agentVars: {
      ...readAgentCliSettings(),
      provider: readConfiguredAiProvider(),
      cursorAgentInstalled: await isCursorAgentInstalled(),
      chatgptCliInstalled: isChatgptCliInstalled(),
      antigravityCliInstalled: isAntigravityCliInstalled(),
      opencodeInstalled: isOpenCodeConfigured(),
      apiConfigured: isNotesAiConfigured(),
    },

    infraVars: {
      awsProfile: infrastructure.awsProfile,
      account: null,
      scriptsRepoPath: infrastructure.scriptsRepoPath,
    },
  });
}
