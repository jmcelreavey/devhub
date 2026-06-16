import { NextResponse, type NextRequest } from "next/server";
import { readDashboardEnvLocalFile, resolveEnvValue } from "@/lib/dashboard-env-local";
import { resolveDatadogApplicationKey } from "@/lib/datadog-application-key";
import { datadogApiHost } from "@/lib/datadog-links";
import { isSameOrigin, parseBody } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

interface CheckResult {
  ok: boolean;
  code: string;
  message: string;
}

/**
 * Validate a Datadog API + application key pair against the Events search API.
 * Values passed in (e.g. from the unsaved setup form) take precedence; anything
 * omitted falls back to the saved env so the button works both before and after
 * the step is saved.
 */
async function runDatadogCheck(input: {
  apiKey?: string;
  applicationKey?: string;
}): Promise<CheckResult> {
  const { overrides } = readDashboardEnvLocalFile();
  const apiKey = input.apiKey?.trim() || resolveEnvValue("DATADOG_API_KEY", overrides);
  if (!apiKey) {
    return {
      ok: false,
      code: "missing_api_key",
      message:
        "Datadog API key not found. Enter it in the form above, or set DATADOG_API_KEY in dashboard/.env.local.",
    };
  }

  const applicationKey = input.applicationKey?.trim() || resolveDatadogApplicationKey(overrides);
  if (!applicationKey) {
    return {
      ok: false,
      code: "missing_application_key",
      message:
        "Datadog application key not found. Enter it in the form above, or set DATADOG_APPLICATION_KEY in dashboard/.env.local.",
    };
  }

  const ddSite = resolveEnvValue("DD_SITE", overrides) ?? process.env.DD_SITE?.trim() ?? "datadoghq.com";
  const apiHost = datadogApiHost(ddSite);

  try {
    const res = await fetch(`https://${apiHost}/api/v2/events/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "DD-API-KEY": apiKey,
        "DD-APPLICATION-KEY": applicationKey,
      },
      body: JSON.stringify({
        filter: { query: "_nonexistent_tag_xxxxx", from: "now-5m", to: "now" },
        sort: "-timestamp",
        page: { limit: 1 },
      }),
    });

    if (res.status === 403 || res.status === 401) {
      return {
        ok: false,
        code: "auth_failed",
        message: `Datadog authentication failed (HTTP ${res.status}). Check that your API key and application key are valid.`,
      };
    }

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const detail =
        Array.isArray(body.errors) ? (body.errors as string[]).join("; ") : `${res.status} ${res.statusText}`;
      return {
        ok: false,
        code: "upstream_error",
        message: `Datadog returned an error: ${detail}`,
      };
    }

    return { ok: true, code: "connected", message: "Connected to Datadog successfully." };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return {
      ok: false,
      code: "network_error",
      message: `Could not reach Datadog at https://${apiHost}: ${msg}`,
    };
  }
}

/** Validate the saved env config (no form values). */
export async function GET() {
  return NextResponse.json(await runDatadogCheck({}));
}

/**
 * Validate the credentials currently entered in the setup form, before they're
 * saved. The form sends only fields the user actually changed (masked/untouched
 * secrets are omitted), and those fall back to the saved env.
 */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, code: "forbidden", message: "Forbidden" }, { status: 403 });
  }

  const body = await parseBody<{ apiKey?: unknown; applicationKey?: unknown }>(req);

  return NextResponse.json(
    await runDatadogCheck({
      apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
      applicationKey: typeof body.applicationKey === "string" ? body.applicationKey : undefined,
    }),
  );
}
