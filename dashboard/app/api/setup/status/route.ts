import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { readDashboardEnvLocalFile, resolveEnvValue } from "@/lib/dashboard-env-local";
import { getReposDir, hasCheckout, isDesktopRuntime } from "@/lib/desktop/runtime-paths";
import { resolveDatadogApplicationKey } from "@/lib/datadog/application-key";
import { getResolvedGoogleCalendarEnv } from "@/lib/google-calendar";
import { isGithubCliAuthenticated } from "@/lib/repos";
import { detectBiPresence } from "@/lib/bi-presence";
import { getPeerServiceGateStatus } from "@/lib/peer-service-availability";
import { isCursorAgentInstalled, readAgentCliSettings } from "@/lib/agent/cli-env";

export const dynamic = "force-dynamic";

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
  const { overrides } = readDashboardEnvLocalFile();

  // Detect the current devhub repo root. The dashboard is run from inside
  // devhub/dashboard, so cwd's parent is the repo. Falls back to that if
  // REPO_ROOT isn't set.
  const resolvedRepoRoot = resolveEnvValue("REPO_ROOT", overrides);
  const detectedRepo = resolvedRepoRoot ?? path.resolve(process.cwd(), "..");
  const defaultRepoRoot = path.dirname(detectedRepo);
  const defaultNotesDir = path.join(detectedRepo, "notes");

  const google = getResolvedGoogleCalendarEnv();
  const calendar = !!(google.clientId && google.clientSecret && google.refreshToken);
  /**
   * When Calendar OAuth is not finished, echo saved Web client creds so /setup can rehydrate the form.
   * Local-only dashboard; values already live in `dashboard/.env.local`.
   */
  const calendarClientIdPreview =
    google.clientId && google.clientSecret && !calendar ? google.clientId : null;
  const calendarClientSecretPreview =
    google.clientId && google.clientSecret && !calendar ? google.clientSecret : null;

  const jira = !!(
    resolveEnvValue("JIRA_DOMAIN", overrides) &&
    resolveEnvValue("JIRA_EMAIL", overrides) &&
    resolveEnvValue("JIRA_API_TOKEN", overrides)
  );

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
  const datadogApiKey = !!resolveEnvValue("DATADOG_API_KEY", overrides);
  const datadogApplicationKey = !!resolveDatadogApplicationKey(overrides);
  const configuredEmail = resolveEnvValue("BI_OPS_USER_EMAIL", overrides);
  const datadogEmail = !!configuredEmail;
  const datadogScheduleId = !!resolveEnvValue("DATADOG_ONCALL_SCHEDULE_ID", overrides);
  // The nav/page should be available once Datadog API credentials exist. Email
  // only controls on-call matching.
  const datadog = datadogApiKey && datadogApplicationKey;

  // BI presence drives the `bi` nav gate. Detection is dependency-free (no BI feature
  // libs) so the BI Ops module can live in the devhub-bi plugin. Rich identity/account
  // data is shown by the plugin's /ops page via /api/bi.
  const biPresence = detectBiPresence((key) => resolveEnvValue(key, overrides));
  const bi = biPresence.bi;

  const bindHost = resolveEnvValue("DEVHUB_BIND_HOST", overrides)?.trim();
  const lanProxyHost = resolveEnvValue("DEVHUB_LAN_PROXY_HOST", overrides)?.trim();
  const chamberHost = resolveEnvValue("OPENCHAMBER_HOST", overrides)?.trim();
  const opencodeBindHost =
    resolveEnvValue("OPENCODE_BIND_HOST", overrides)?.trim()
    ?? resolveEnvValue("OPENCODE_HOST", overrides)?.trim();
  const allowLanNetwork = !!lanProxyHost || (
    bindHost !== "127.0.0.1" && chamberHost !== "127.0.0.1" && opencodeBindHost !== "127.0.0.1"
  );
  const hasOpenchamberUiPassword = !!resolveEnvValue("OPENCHAMBER_UI_PASSWORD", overrides);

  const peerServices = await getPeerServiceGateStatus();

  return NextResponse.json({
    core,
    github,
    calendar,
    jira,
    datadog,
    bi,
    chamber: peerServices.chamber,
    opencode: peerServices.opencode,
    claude: peerServices.claude,
    cursor: peerServices.cursor,
    allowLanNetwork,
    hasOpenchamberUiPassword,
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
      hasDomain: !!resolveEnvValue("JIRA_DOMAIN", overrides),
      hasEmail: !!resolveEnvValue("JIRA_EMAIL", overrides),
      hasApiToken: !!resolveEnvValue("JIRA_API_TOKEN", overrides),
    },
    githubVars: {
      authenticated: github,
    },
    datadogVars: {
      hasApiKey: datadogApiKey,
      hasApplicationKey: datadogApplicationKey,
      hasEmail: datadogEmail,
      hasScheduleId: datadogScheduleId,
      email: resolveEnvValue("BI_OPS_USER_EMAIL", overrides) ?? "",
      scheduleId: resolveEnvValue("DATADOG_ONCALL_SCHEDULE_ID", overrides) ?? "",
    },
    agentVars: {
      ...readAgentCliSettings(),
      cursorAgentInstalled: isCursorAgentInstalled(),
    },
    biVars: {
      awsProfile: biPresence.awsProfile,
      // Live AWS account id comes from the BI plugin's /ops page (/api/bi), not here —
      // keeps setup/status free of BI feature libs and avoids an STS call per poll.
      account: null,
      capiRepoPath: biPresence.capiRepoPath,
    },
  });
}
