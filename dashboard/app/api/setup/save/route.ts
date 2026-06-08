import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  readDashboardEnvLocalFile,
  syncBiProcessEnvFromOverrides,
  syncDatadogProcessEnvFromOverrides,
  syncGoogleProcessEnvFromOverrides,
  syncJiraProcessEnvFromOverrides,
  writeDashboardEnvLocalFile,
} from "@/lib/dashboard-env-local";

export const dynamic = "force-dynamic";

function mask(val: string): string {
  if (val.length <= 8) return "****";
  return val.slice(0, 4) + "****" + val.slice(-4);
}

function expandHome(p: string): string {
  if (!p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function validateDirectory(p: string): string | null {
  const resolved = path.resolve(expandHome(p));
  if (!path.isAbsolute(resolved)) return "Path must be absolute";
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return "Path does not exist";
  }
  if (!stat.isDirectory()) return "Path is not a directory";
  return null;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { calendar, jira, datadog, core, network, bi } = body as {
    calendar?: { clientId?: string; clientSecret?: string; refreshToken?: string };
    jira?: { domain: string; email: string; apiToken: string };
    datadog?: { apiKey?: string; applicationKey?: string; email?: string; scheduleId?: string } | null;
    core?: { repoRoot?: string; notesDir?: string };
    network?: { allowLan: boolean };
    bi?: { capiRepoPath?: string };
  };

  // Validate core paths up-front so we don't half-write the env file.
  if (core) {
    if (core.repoRoot !== undefined && core.repoRoot.trim()) {
      const err = validateDirectory(core.repoRoot);
      if (err) {
        return NextResponse.json(
          { ok: false, error: `REPO_ROOT: ${err}` },
          { status: 400 },
        );
      }
    }
    if (core.notesDir !== undefined && core.notesDir.trim()) {
      const err = validateDirectory(core.notesDir);
      if (err) {
        return NextResponse.json(
          { ok: false, error: `NOTES_DIR: ${err}` },
          { status: 400 },
        );
      }
    }
  }

  if (bi?.capiRepoPath !== undefined && bi.capiRepoPath.trim()) {
    const err = validateDirectory(bi.capiRepoPath);
    if (err) {
      return NextResponse.json(
        { ok: false, error: `CAPI_REPO_PATH: ${err}` },
        { status: 400 },
      );
    }
  }

  const { overrides: baseOverrides, passthrough } = readDashboardEnvLocalFile();
  const overrides = new Map(baseOverrides);

  let needsRestartNotice = !!(core ?? network);

  if (core) {
    if (core.repoRoot !== undefined) {
      const v = core.repoRoot.trim();
      if (v) overrides.set("REPO_ROOT", path.resolve(expandHome(v)));
      else overrides.delete("REPO_ROOT");
      needsRestartNotice = true;
    }
    if (core.notesDir !== undefined) {
      const v = core.notesDir.trim();
      if (v) overrides.set("NOTES_DIR", path.resolve(expandHome(v)));
      else overrides.delete("NOTES_DIR");
      needsRestartNotice = true;
    }
  }

  if (calendar) {
    if (calendar.clientId) overrides.set("GOOGLE_CLIENT_ID", calendar.clientId);
    if (calendar.clientSecret) overrides.set("GOOGLE_CLIENT_SECRET", calendar.clientSecret);
    if (calendar.refreshToken) overrides.set("GOOGLE_REFRESH_TOKEN", calendar.refreshToken);
  } else if (calendar === null) {
    overrides.delete("GOOGLE_CLIENT_ID");
    overrides.delete("GOOGLE_CLIENT_SECRET");
    overrides.delete("GOOGLE_REFRESH_TOKEN");
    overrides.delete("GOOGLE_OAUTH_REDIRECT_URI");
  }

  if (jira) {
    if (jira.domain) overrides.set("JIRA_DOMAIN", jira.domain);
    if (jira.email) overrides.set("JIRA_EMAIL", jira.email);
    if (jira.apiToken) overrides.set("JIRA_API_TOKEN", jira.apiToken);
  } else if (jira === null) {
    overrides.delete("JIRA_DOMAIN");
    overrides.delete("JIRA_EMAIL");
    overrides.delete("JIRA_API_TOKEN");
  }

  if (datadog) {
    if (datadog.apiKey) overrides.set("DATADOG_API_KEY", datadog.apiKey);
    if (datadog.applicationKey) overrides.set("DATADOG_APPLICATION_KEY", datadog.applicationKey);
    // Shared identity — also used by BI Ops. Empty string clears the schedule.
    if (datadog.email !== undefined) {
      const v = datadog.email.trim();
      if (v) overrides.set("BI_OPS_USER_EMAIL", v);
    }
    if (datadog.scheduleId !== undefined) {
      const v = datadog.scheduleId.trim();
      if (v) overrides.set("DATADOG_ONCALL_SCHEDULE_ID", v);
      else overrides.delete("DATADOG_ONCALL_SCHEDULE_ID");
    }
  } else if (datadog === null) {
    overrides.delete("DATADOG_API_KEY");
    overrides.delete("DATADOG_APPLICATION_KEY");
    overrides.delete("DATADOG_ONCALL_SCHEDULE_ID");
  }

  if (network !== undefined) {
    if (network.allowLan) {
      overrides.delete("DEVHUB_BIND_HOST");
      overrides.delete("OPENCHAMBER_HOST");
      overrides.delete("OPENCODE_BIND_HOST");
      overrides.delete("OPENCODE_HOST");
    } else {
      overrides.set("DEVHUB_BIND_HOST", "127.0.0.1");
      overrides.set("OPENCHAMBER_HOST", "127.0.0.1");
      overrides.set("OPENCODE_BIND_HOST", "127.0.0.1");
      overrides.delete("OPENCODE_HOST");
    }
    needsRestartNotice = true;
  }

  if (bi) {
    if (bi.capiRepoPath !== undefined) {
      const v = bi.capiRepoPath.trim();
      if (v) overrides.set("CAPI_REPO_PATH", path.resolve(expandHome(v)));
      else overrides.delete("CAPI_REPO_PATH");
    }
  }

  writeDashboardEnvLocalFile(overrides, passthrough);
  syncGoogleProcessEnvFromOverrides(overrides);
  syncJiraProcessEnvFromOverrides(overrides);
  syncDatadogProcessEnvFromOverrides(overrides);
  syncBiProcessEnvFromOverrides(overrides);

  const saved: string[] = [];
  if (core?.repoRoot && overrides.get("REPO_ROOT")) saved.push(`REPO_ROOT=${overrides.get("REPO_ROOT")}`);
  if (core?.notesDir && overrides.get("NOTES_DIR")) saved.push(`NOTES_DIR=${overrides.get("NOTES_DIR")}`);
  if (calendar?.clientId) saved.push(`GOOGLE_CLIENT_ID=${mask(calendar.clientId)}`);
  if (calendar?.clientSecret) saved.push(`GOOGLE_CLIENT_SECRET=${mask(calendar.clientSecret)}`);
  if (calendar?.refreshToken) saved.push(`GOOGLE_REFRESH_TOKEN=${mask(calendar.refreshToken)}`);
  if (jira?.domain) saved.push(`JIRA_DOMAIN=${jira.domain}`);
  if (jira?.email) saved.push(`JIRA_EMAIL=${jira.email}`);
  if (jira?.apiToken) saved.push(`JIRA_API_TOKEN=${mask(jira.apiToken)}`);
  if (datadog?.apiKey) saved.push(`DATADOG_API_KEY=${mask(datadog.apiKey)}`);
  if (datadog?.applicationKey) saved.push(`DATADOG_APPLICATION_KEY=${mask(datadog.applicationKey)}`);
  if (datadog?.email?.trim()) saved.push(`BI_OPS_USER_EMAIL=${datadog.email.trim()}`);
  if (datadog?.scheduleId?.trim()) saved.push(`DATADOG_ONCALL_SCHEDULE_ID=${datadog.scheduleId.trim()}`);
  if (bi?.capiRepoPath && overrides.get("CAPI_REPO_PATH")) saved.push(`CAPI_REPO_PATH=${overrides.get("CAPI_REPO_PATH")}`);

  const message = needsRestartNotice
    ? "Saved. Restart the dev server for core paths or network bind changes. Other values are already active in this session."
    : "Saved. Changes apply immediately.";

  return NextResponse.json({
    ok: true,
    saved,
    message,
  });
}
