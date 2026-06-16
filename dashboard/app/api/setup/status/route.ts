import { NextResponse } from "next/server";
import path from "node:path";
import { readDashboardEnvLocalFile, resolveEnvValue } from "@/lib/dashboard-env-local";
import { resolveDatadogApplicationKey } from "@/lib/datadog-application-key";
import { getResolvedGoogleCalendarEnv } from "@/lib/google-calendar";
import { isGithubCliAuthenticated } from "@/lib/repos";
import { detectBiPresence } from "@/lib/bi-presence";
import { getPeerServiceGateStatus } from "@/lib/peer-service-availability";

export const dynamic = "force-dynamic";

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

  const effectiveRepoRoot = resolveEnvValue("REPO_ROOT", overrides) ?? defaultRepoRoot;
  const effectiveNotesDir = resolveEnvValue("NOTES_DIR", overrides) ?? defaultNotesDir;
  const core = !!(effectiveRepoRoot && effectiveNotesDir);
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
  const chamberHost = resolveEnvValue("OPENCHAMBER_HOST", overrides)?.trim();
  const opencodeBindHost =
    resolveEnvValue("OPENCODE_BIND_HOST", overrides)?.trim()
    ?? resolveEnvValue("OPENCODE_HOST", overrides)?.trim();
  /** When unset, dev/start scripts default to 0.0.0.0 (LAN). Any host locked to localhost disables LAN. */
  const allowLanNetwork =
    bindHost !== "127.0.0.1" && chamberHost !== "127.0.0.1" && opencodeBindHost !== "127.0.0.1";

  const peerServices = await getPeerServiceGateStatus(process.cwd());

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
    allowLanNetwork,
    envPath: ".env.local",
    coreVars: {
      repoRoot: resolveEnvValue("REPO_ROOT", overrides) ?? "",
      notesDir: resolveEnvValue("NOTES_DIR", overrides) ?? "",
    },
    coreDefaults: {
      repoRoot: defaultRepoRoot,
      notesDir: defaultNotesDir,
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
    biVars: {
      awsProfile: biPresence.awsProfile,
      // Live AWS account id comes from the BI plugin's /ops page (/api/bi), not here —
      // keeps setup/status free of BI feature libs and avoids an STS call per poll.
      account: null,
      capiRepoPath: biPresence.capiRepoPath,
    },
  });
}
