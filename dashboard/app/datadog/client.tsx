"use client";

import { useCallback, type ReactNode } from "react";
import Link from "next/link";
import { ExternalLink, LineChart, RefreshCw } from "lucide-react";
import { useLive } from "@/lib/use-fetch";
import type { DatadogLinksApiResponse } from "@/lib/datadog-links";
import type { DatadogRecentAlertsResponse, RecentEvent } from "@/lib/datadog-recent-events";
import type { OncallStatus } from "@/lib/datadog-oncall";
import { formatTime } from "@/lib/utils";
import { DatadogInvestigateButton } from "@/components/DatadogInvestigateButton";

/** At-a-glance "am I on the pager?" banner — always shown once Datadog is configured. */
function OncallBanner() {
  const { data } = useLive<OncallStatus>("/api/datadog/oncall", { refreshInterval: 300_000 });
  if (!data) {
    return <div className="skeleton rounded-lg mb-4" style={{ height: 52 }} aria-hidden />;
  }

  let tone: "accent" | "muted" | "warning" = "muted";
  let title: string;
  let detail: ReactNode = null;

  if (data.ok && data.onCall) {
    tone = "accent";
    title = "You're on call";
    detail = "Datadog alerts appear in your Today strip and morning briefing.";
  } else if (data.ok) {
    title = "You're not on call";
    detail = "On-call alerts stay out of your Today strip and briefing until your next shift.";
  } else if (data.code === "needs_email") {
    tone = "warning";
    title = "On-call detection not set up";
    detail = (
      <>
        {data.message}{" "}
        <Link href="/setup" className="underline underline-offset-2" style={{ color: "var(--accent)" }}>
          Open Setup
        </Link>
      </>
    );
  } else {
    tone = "warning";
    title = "On-call status unavailable";
    detail = data.message;
  }

  const accent =
    tone === "accent" ? "var(--accent)" : tone === "warning" ? "var(--warning)" : "var(--text-subtle)";

  return (
    <div
      className="rounded-lg border p-3 mb-4 flex items-start gap-3"
      style={{
        borderColor: `color-mix(in oklab, ${accent} 35%, transparent)`,
        background: `color-mix(in oklab, ${accent} 8%, var(--bg-elevated))`,
      }}
    >
      <span className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: accent }} aria-hidden />
      <div className="min-w-0">
        <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          {title}
        </div>
        {detail ? (
          <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            {detail}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RecentAlertList({
  events,
  scope,
  tone,
}: {
  events: RecentEvent[];
  scope: "oncall" | "team";
  tone: "danger" | "warning";
}) {
  const accent = tone === "danger" ? "var(--danger)" : "var(--warning)";
  if (events.length === 0) {
    return (
      <p className="text-xs" style={{ color: "var(--text-subtle)" }}>
        Nothing in the last 24h. Quiet is good.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {events.map((e) => (
        <div key={e.id || `${e.title}-${e.timestampMs}`} className="group flex items-start gap-2">
          <span
            className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: accent }}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm break-words leading-snug" style={{ color: "var(--text)" }}>
              {e.title}
            </div>
            <div className="text-[11px] font-mono" style={{ color: "var(--text-subtle)" }}>
              {e.timestampMs ? formatTime(e.timestampMs) : ""}
              {e.status ? ` · ${e.status}` : ""}
            </div>
          </div>
          <span className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <DatadogInvestigateButton scope={scope} alert={e} compact />
          </span>
        </div>
      ))}
    </div>
  );
}

export default function DatadogClient() {
  const { data: links, error: linksError, isLoading: linksLoading, mutate: mutateLinks } = useLive<
    DatadogLinksApiResponse
  >("/api/datadog/links", { refreshInterval: 0 });

  const recentKey = links?.configured ? "/api/datadog/recent-alerts" : null;
  const { data: recent, isLoading: recentLoading, mutate: mutateRecent } = useLive<DatadogRecentAlertsResponse>(
    recentKey,
    { refreshInterval: 120_000 },
  );

  const refresh = useCallback(() => {
    void mutateLinks();
    void mutateRecent();
  }, [mutateLinks, mutateRecent]);

  if (linksLoading && !links) {
    return (
      <div className="page-wrapper" style={{ padding: "24px" }}>
        <div className="skeleton" style={{ height: 24, width: "40%", marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 140, width: "100%", marginBottom: 12 }} />
        <div className="skeleton" style={{ height: 200, width: "100%" }} />
      </div>
    );
  }

  if (linksError || !links) {
    return (
      <div className="page-wrapper" style={{ padding: "24px", color: "var(--danger)" }}>
        Could not load Datadog links. Try again or check the dev server.
      </div>
    );
  }

  if (!links.configured) {
    return (
      <div className="page-wrapper" style={{ padding: "24px", maxWidth: 520 }}>
        <h1 className="text-lg font-semibold mb-2" style={{ color: "var(--text)" }}>
          Datadog
        </h1>
        <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
          Add your Datadog API key in Setup to unlock this page and the Today strip.
        </p>
        <Link href="/setup" className="btn btn-primary text-sm">
          Open Setup
        </Link>
      </div>
    );
  }

  const linkBtn =
    "btn inline-flex items-center gap-2 text-sm w-full justify-center sm:w-auto sm:justify-start";

  const recentOk = recent && recent.ok === true;
  const recentNeedsKey = recent && recent.ok === false && recent.code === "needs_application_key";
  const recentErr =
    recent && recent.ok === false && (recent.code === "upstream" || recent.code === "not_configured");

  return (
    <div className="page-wrapper" style={{ padding: "24px", maxWidth: 900 }}>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className="flex items-center justify-center rounded-lg shrink-0"
            style={{
              width: 44,
              height: 44,
              background: "var(--accent-dim)",
              color: "var(--accent)",
            }}
          >
            <LineChart size={24} aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold" style={{ color: "var(--text)" }}>
              Datadog
            </h1>
            <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
              On-call queues, today&apos;s stream, and the most recent alerts (last 24h) when an
              application key is set. Site <span className="font-mono text-xs">{links.ddSite}</span>.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-ghost inline-flex items-center gap-2 text-xs shrink-0"
          onClick={() => void refresh()}
          title="Refresh links and counts"
        >
          <RefreshCw size={14} aria-hidden />
          Refresh
        </button>
      </div>

      <OncallBanner />

      {/* Recent alerts */}
      <section className="mb-6" aria-label="Recent alerts last 24 hours">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            Recent alerts <span className="font-normal" style={{ color: "var(--text-subtle)" }}>· last 24h</span>
          </h2>
          {recentOk && (
            <span className="text-[11px] font-mono" style={{ color: "var(--text-subtle)" }}>
              Updated {new Date(recent.fetchedAt).toLocaleTimeString()}
            </span>
          )}
        </div>

        {recentLoading && !recent && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[1, 2].map((i) => (
              <div key={i} className="skeleton rounded-lg" style={{ height: 160 }} />
            ))}
          </div>
        )}

        {recent && recentNeedsKey && (
          <div
            className="rounded-lg border p-4 text-sm"
            style={{ borderColor: "var(--border-muted)", background: "var(--bg-elevated)", color: "var(--text-muted)" }}
          >
            <p className="mb-2">{recent.message}</p>
            <Link href="/setup" className="text-sm underline underline-offset-2" style={{ color: "var(--accent)" }}>
              Open Setup — add application key
            </Link>
          </div>
        )}

        {recent && recentErr && (
          <p className="text-sm" style={{ color: "var(--danger)" }}>
            {recent.message}
          </p>
        )}

        {recentOk && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div
              className="rounded-lg border p-4"
              style={{ borderColor: "color-mix(in oklab, var(--danger) 30%, transparent)", background: "var(--bg-elevated)" }}
            >
              <div className="flex items-center justify-between gap-2 mb-3">
                <h3 className="text-sm font-semibold" style={{ color: "var(--danger)" }}>
                  @oncall-dad <span className="font-normal text-xs" style={{ color: "var(--text-subtle)" }}>(urgent)</span>
                </h3>
                <DatadogInvestigateButton scope="oncall" label="Investigate queue" />
              </div>
              <RecentAlertList events={recent.oncall} scope="oncall" tone="danger" />
            </div>
            <div
              className="rounded-lg border p-4"
              style={{ borderColor: "color-mix(in oklab, var(--warning) 30%, transparent)", background: "var(--bg-elevated)" }}
            >
              <div className="flex items-center justify-between gap-2 mb-3">
                <h3 className="text-sm font-semibold" style={{ color: "var(--warning)" }}>
                  @slack-dad-team-alerts
                </h3>
                <DatadogInvestigateButton scope="team" label="Investigate queue" />
              </div>
              <RecentAlertList events={recent.teamSlack} scope="team" tone="warning" />
            </div>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <section
          className="rounded-lg border p-4"
          style={{ borderColor: "var(--border-muted)", background: "var(--bg-elevated)" }}
        >
          <h2 className="text-sm font-semibold mb-1" style={{ color: "var(--danger)" }}>
            On-call (urgent)
          </h2>
          <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
            Monitors that notify <code className="font-mono">@oncall-dad</code> — pages / SMS the on-call engineer.
          </p>
          <a
            href={links.oncallUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={linkBtn}
            style={{ borderColor: "color-mix(in oklab, var(--danger) 40%, transparent)" }}
          >
            Open monitors — @oncall-dad
            <ExternalLink size={14} aria-hidden />
          </a>
        </section>

        <section
          className="rounded-lg border p-4"
          style={{ borderColor: "var(--border-muted)", background: "var(--bg-elevated)" }}
        >
          <h2 className="text-sm font-semibold mb-1" style={{ color: "var(--warning)" }}>
            Team warnings (Slack)
          </h2>
          <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
            Monitors that notify <code className="font-mono">@slack-dad-team-alerts</code> — team channel, not paging.
          </p>
          <a
            href={links.teamAlertsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={linkBtn}
            style={{ borderColor: "color-mix(in oklab, var(--warning) 40%, transparent)" }}
          >
            Open monitors — @slack-dad-team-alerts
            <ExternalLink size={14} aria-hidden />
          </a>
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section
          className="rounded-lg border p-4"
          style={{ borderColor: "var(--border-muted)", background: "var(--bg-elevated)" }}
        >
          <h2 className="text-sm font-semibold mb-1" style={{ color: "var(--text)" }}>
            Today&apos;s events (local day)
          </h2>
          <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
            Event stream from local midnight to now. Override with{" "}
            <code className="font-mono">DATADOG_LINK_EVENTS_TODAY</code> if needed.
          </p>
          <a href={links.eventsTodayUrl} target="_blank" rel="noopener noreferrer" className={linkBtn}>
            Open event stream — today
            <ExternalLink size={14} aria-hidden />
          </a>
        </section>

        <section
          className="rounded-lg border p-4"
          style={{ borderColor: "var(--border-muted)", background: "var(--bg-elevated)" }}
        >
          <h2 className="text-sm font-semibold mb-2" style={{ color: "var(--text)" }}>
            Investigate
          </h2>
          <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
            Hand the on-call queue to OpenCode with the investigation skill pre-loaded, or use the
            per-alert Investigate buttons above.
          </p>
          <DatadogInvestigateButton scope="oncall" label="Investigate on-call queue" />
        </section>
      </div>
    </div>
  );
}
