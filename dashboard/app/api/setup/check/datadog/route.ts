import { NextResponse } from "next/server";
import { readDashboardEnvLocalFile, resolveEnvValue } from "@/lib/dashboard-env-local";
import { resolveDatadogApplicationKey } from "@/lib/datadog-application-key";
import { datadogApiHost } from "@/lib/datadog-links";

export const dynamic = "force-dynamic";

export async function GET() {
  const { overrides } = readDashboardEnvLocalFile();
  const apiKey = resolveEnvValue("DATADOG_API_KEY", overrides);
  if (!apiKey) {
    return NextResponse.json({
      ok: false,
      code: "missing_api_key",
      message:
        "Datadog API key not found. Set DATADOG_API_KEY in dashboard/.env.local or your shell environment.",
    });
  }

  const applicationKey = resolveDatadogApplicationKey(overrides);
  if (!applicationKey) {
    return NextResponse.json({
      ok: false,
      code: "missing_application_key",
      message:
        "Datadog application key not found. Set DATADOG_APPLICATION_KEY, DD_APPLICATION_KEY, or DATADOG_APP_KEY in dashboard/.env.local or your shell environment.",
    });
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
      return NextResponse.json({
        ok: false,
        code: "auth_failed",
        message: `Datadog authentication failed (HTTP ${res.status}). Check that your API key and application key are valid.`,
      });
    }

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const detail =
        Array.isArray(body.errors) ? (body.errors as string[]).join("; ") : `${res.status} ${res.statusText}`;
      return NextResponse.json({
        ok: false,
        code: "upstream_error",
        message: `Datadog returned an error: ${detail}`,
      });
    }

    return NextResponse.json({ ok: true, code: "connected", message: "Connected to Datadog successfully." });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({
      ok: false,
      code: "network_error",
      message: `Could not reach Datadog at https://${apiHost}: ${msg}`,
    });
  }
}
