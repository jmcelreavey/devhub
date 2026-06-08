"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ExternalLink, LineChart } from "lucide-react";
import { useLive } from "@/lib/use-fetch";
import type { DatadogLinksApiResponse } from "@/lib/datadog-links";
import type { DatadogRecentAlertsResponse } from "@/lib/datadog-recent-events";
import type { OncallStatus } from "@/lib/datadog-oncall";
import { HUB_STRIP_ICON_PX, hubStripSetupLinkStyle, hubStripSetupLinkClassName } from "@/lib/hub-strip";
import { HubSignalStrip } from "@/components/HubSignalStrip";
import { TodayCollapseButton } from "@/components/TodayCollapseButton";
import { DatadogInvestigateButton } from "@/components/DatadogInvestigateButton";

/** `true` once Datadog is configured *and* this user is on call — Today only cares when it's your pager. */
export function useDatadogTodayPanelVisible(): boolean {
  const { data: links } = useLive<DatadogLinksApiResponse>("/api/datadog/links", {
    refreshInterval: 0,
  });
  const { data: oncall } = useLive<OncallStatus>(
    links?.configured ? "/api/datadog/oncall" : null,
    { refreshInterval: 300_000 },
  );
  return links?.configured === true && oncall?.ok === true && oncall.onCall === true;
}

/** One-line summary for collapsed Today section. */
export function DatadogCollapsedSummary() {
  const visible = useDatadogTodayPanelVisible();
  const { data: recent } = useLive<DatadogRecentAlertsResponse>(
    visible ? "/api/datadog/recent-alerts" : null,
    { refreshInterval: 120_000 },
  );

  if (!visible) return null;

  if (recent && recent.ok) {
    return (
      <span>
        on-call {recent.oncall.length} · Slack {recent.teamSlack.length} recent
      </span>
    );
  }
  if (recent && !recent.ok && recent.code === "needs_application_key") {
    return <span>Add app key for alerts</span>;
  }
  if (recent && !recent.ok) {
    return <span>Alerts unavailable</span>;
  }
  return <span className="inline-block h-3 w-24 rounded skeleton" aria-hidden />;
}

interface DatadogTodayStripProps {
  /** `embedded` = body only when another surface provides the chrome. */
  variant?: "strip" | "embedded";
  className?: string;
  collapsed?: boolean;
  collapsedSummary?: ReactNode;
  onToggle?: () => void;
}

export function DatadogTodayStrip({
  variant = "strip",
  className = "mb-3",
  collapsed = false,
  collapsedSummary,
  onToggle,
}: DatadogTodayStripProps) {
  const visible = useDatadogTodayPanelVisible();
  const { data: links } = useLive<DatadogLinksApiResponse>("/api/datadog/links", {
    refreshInterval: 0,
  });

  const recentKey = visible ? "/api/datadog/recent-alerts" : null;
  const { data: recent } = useLive<DatadogRecentAlertsResponse>(recentKey, {
    refreshInterval: 120_000,
  });

  if (!visible || !links?.configured) return null;

  const linkClass =
    "inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors hover:opacity-90";
  const subtle = "var(--text-muted)";

  const latestOncall = recent && recent.ok ? recent.oncall[0] : undefined;

  const counts =
    recent && recent.ok ? (
      <span className="font-mono text-[11px] tabular-nums min-w-0 truncate" style={{ color: subtle }}>
        <span style={{ color: "var(--danger)" }}>{recent.oncall.length} on-call</span>
        {" · "}
        {recent.teamSlack.length} team-slack
        {latestOncall ? (
          <span style={{ color: "var(--text-subtle)" }}> · latest: {latestOncall.title}</span>
        ) : null}
      </span>
    ) : recent && !recent.ok && recent.code === "needs_application_key" ? (
      <span className="text-[11px]" style={{ color: subtle }}>
        Add application key in{" "}
        <Link href="/setup" className={hubStripSetupLinkClassName} style={hubStripSetupLinkStyle}>
          Setup
        </Link>{" "}
        for recent alerts
      </span>
    ) : recent && !recent.ok ? (
      <span className="text-[11px]" style={{ color: "var(--danger)" }} title={recent.message}>
        Alerts unavailable
      </span>
    ) : (
      <span className="skeleton text-[11px]" style={{ minWidth: 120, height: 14, display: "inline-block" }} />
    );

  const actions = (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2 sm:ml-auto">
      <a
        href={links.eventsTodayUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClass}
        style={{ color: subtle }}
      >
        Events today
        <ExternalLink size={11} aria-hidden />
      </a>
      <a
        href={links.oncallUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClass}
        style={{
          color: "var(--danger)",
          background: "color-mix(in oklab, var(--danger) 12%, transparent)",
          border: "1px solid color-mix(in oklab, var(--danger) 35%, transparent)",
        }}
      >
        @oncall-dad
        <ExternalLink size={11} aria-hidden />
      </a>
      <a
        href={links.teamAlertsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClass}
        style={{
          color: "var(--warning)",
          background: "color-mix(in oklab, var(--warning) 12%, transparent)",
          border: "1px solid color-mix(in oklab, var(--warning) 35%, transparent)",
        }}
      >
        @slack-dad-team-alerts
        <ExternalLink size={11} aria-hidden />
      </a>
      <DatadogInvestigateButton scope="oncall" label="Investigate" />
      <Link href="/datadog" className="shrink-0 underline-offset-2 hover:underline" style={{ color: subtle }}>
        Datadog hub
      </Link>
    </div>
  );

  const inner = (
    <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        {counts}
      </div>
      {actions}
    </div>
  );

  if (variant === "embedded") {
    return (
      <div className="min-w-0 py-1 text-xs" style={{ color: "var(--text-muted)" }}>
        {inner}
      </div>
    );
  }

  if (onToggle) {
    return (
      <div className="card" data-collapsed={collapsed ? "true" : undefined} aria-label="Datadog alerts today">
        <div className="card-header today-grid-drag-handle">
          <span className="flex min-w-0 items-center gap-1.5">
            <LineChart size={12} aria-hidden /> Datadog · today
          </span>
          <span className="flex min-w-0 items-center gap-2">
            {collapsed && collapsedSummary ? <span className="today-collapsed-summary">{collapsedSummary}</span> : null}
            <TodayCollapseButton collapsed={collapsed} label="Datadog" onToggle={onToggle} />
          </span>
        </div>
        {!collapsed ? (
          <div className="card-body today-card-body-compact">
            {inner}
          </div>
        ) : null}
      </div>
    );
  }

  const shellClassName = ["today-signal-card", className].filter(Boolean).join(" ");

  return (
    <HubSignalStrip
      className={shellClassName}
      aria-label="Datadog alerts today"
      data-collapsed={collapsed ? "true" : undefined}
    >
      <div className="today-signal-head">
        <span className="today-signal-title" style={{ color: "var(--text)" }}>
          <LineChart size={HUB_STRIP_ICON_PX} style={{ color: "var(--accent)" }} aria-hidden />
          Datadog · today
        </span>
        {(collapsed && collapsedSummary) && (
          <span className="flex min-w-0 items-center gap-2">
            <span className="today-collapsed-summary">{collapsedSummary}</span>
          </span>
        )}
      </div>
      {!collapsed ? <div className="today-signal-body">{inner}</div> : null}
    </HubSignalStrip>
  );
}
