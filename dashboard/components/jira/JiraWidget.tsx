"use client";

import { useMemo } from "react";
import { Ticket, AlertCircle } from "lucide-react";
import Link from "next/link";
import { useLive } from "@/lib/hooks/use-fetch";
import type { JiraTicket } from "@/lib/jira/client";
import { TodayCollapseButton } from "@/components/today/TodayCollapseButton";
import { type SeverityTone } from "@/components/ui/Severity";
import { JiraStatusPill } from "@/components/jira/JiraStatusPill";
import { JiraTicketRow } from "@/components/jira/JiraTicketRow";
import { useGridSize } from "@/lib/hooks/use-grid-size";
import { QueueRow } from "@/components/ui/QueueRow";
import { PersonChip } from "@/components/PersonChip";

interface JiraResponse {
  tickets?: JiraTicket[];
  configured?: boolean;
}

interface JiraWidgetProps {
  collapsed?: boolean;
  collapsedSummary?: string;
  onToggle?: () => void;
}

export function statusTone(status: string): SeverityTone {
  const s = status.toLowerCase();
  if (s.includes("done") || s.includes("closed") || s.includes("merged")) return "success";
  if (s.includes("block")) return "critical";
  if (s.includes("qa")) return "brand";
  if (s.includes("progress") || s.includes("dev")) return "info";
  if (s.includes("review") || s.includes("change")) return "warning";
  if (s.includes("todo") || s.includes("backlog") || s.includes("to do") || s.includes("open")) return "muted";
  return "muted";
}

/** @deprecated Use statusTone + SeverityDot/SeverityPill instead. */
export function statusColor(status: string): string {
  const t = statusTone(status);
  const map: Record<SeverityTone, string> = {
    success: "var(--success)", critical: "var(--danger)", violet: "var(--info)",
    info: "var(--info)", warning: "var(--warning)", muted: "var(--text-subtle)", brand: "var(--accent)",
  };
  return map[t];
}

export function priorityIcon(priority: string): string {
  const p = priority.toLowerCase();
  if (p.includes("highest")) return "🔴";
  if (p.includes("high")) return "🟠";
  if (p.includes("medium")) return "🟡";
  if (p.includes("low")) return "🔵";
  if (p.includes("lowest")) return "⚪";
  return "⚪";
}

export function JiraWidget({ collapsed = false, collapsedSummary, onToggle }: JiraWidgetProps) {
  const { data, error, isLoading } = useLive<JiraResponse>("/api/jira/tickets");
  const gridSize = useGridSize("jira");

  const sortedTickets = useMemo(() => {
    const list = data?.tickets ?? [];
    return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [data?.tickets]);

  if (isLoading) {
    return (
      <div className="skeleton" style={{ height: 100, borderRadius: "var(--radius)" }} />
    );
  }

  if (error) {
    return (
      <div
        className="card"
        style={{
          padding: "8px 12px",
          fontSize: 12,
          color: "var(--text-muted)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <AlertCircle size={12} className="text-danger" aria-hidden />
        Couldn&apos;t reach Jira.
      </div>
    );
  }

  if (!data?.configured) return null;
  if (sortedTickets.length === 0) return null;

  return (
    <div className="card" data-collapsed={collapsed ? "true" : undefined}>
      <div className="card-header today-grid-drag-handle">
        <span className="flex min-w-0 items-center gap-1.5">
          <Ticket size={12} aria-hidden /> My Tickets
        </span>
        <span className="flex min-w-0 items-center gap-2">
          {collapsed ? <span className="today-collapsed-summary">{collapsedSummary}</span> : null}
          <Link href="/tickets" className="text-xs today-grid-drag-cancel text-accent">
            View all →
          </Link>
          {onToggle ? <TodayCollapseButton collapsed={collapsed} label="Jira" onToggle={onToggle} /> : null}
        </span>
      </div>
      {!collapsed ? (
        <div className="card-body" style={{ padding: 0 }}>
          {gridSize === "1x1" ? (
            <div className="px-4 py-3 space-y-1">
              <div className="text-2xl font-semibold tabular-nums" style={{ color: "var(--text)", lineHeight: 1 }}>
                {sortedTickets.length}
              </div>
              <div className="text-[11px] text-text-subtle">
                {["critical", "warning", "info", "success"].map((tone) => {
                  const n = sortedTickets.filter((t) => statusTone(t.status) === tone).length;
                  return n > 0 ? `${n} ${tone === "info" ? "in dev" : tone === "warning" ? "in review" : tone === "critical" ? "blocked" : "done"}` : null;
                }).filter(Boolean).join(" · ") || "tickets"}
              </div>
            </div>
          ) : gridSize === "2x1" ? (
            <div role="list" aria-label="Your Jira tickets">
              {sortedTickets.slice(0, 4).map((t) => (
                <div key={t.key} className="flex items-center gap-1.5 pr-2">
                  {t.assignee ? (
                    <PersonChip
                      name={t.assignee.displayName}
                      email={t.assignee.email}
                      avatarUrl={t.assignee.avatarUrl}
                      size={16}
                      nameClassName="sr-only"
                      className="pl-2"
                    />
                  ) : null}
                  <QueueRow
                    className="min-w-0 flex-1"
                    monoKey={t.key}
                    title={t.summary}
                    size="compact"
                    href={t.url}
                    statusPill={<JiraStatusPill ticketKey={t.key} status={t.status} />}
                  />
                </div>
              ))}
              {sortedTickets.length > 4 && (
                <div className="px-3 py-1 text-[11px] text-text-subtle">
                  +{sortedTickets.length - 4} more
                </div>
              )}
            </div>
          ) : (
            <div className="jira-widget-ticket-scroll stagger-children" role="list" aria-label="Your Jira tickets, newest activity first">
              {sortedTickets.map((t, i) => (
                <div
                  key={t.key}
                  role="listitem"
                  className="jira-widget-ticket-row"
                  style={{
                    borderTop: i === 0 ? "none" : "1px solid var(--border-muted)",
                  }}
                >
                  <JiraTicketRow ticket={t} density="compact" />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
