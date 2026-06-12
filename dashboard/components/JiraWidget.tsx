"use client";

import { useCallback, useMemo } from "react";
import { Ticket, ExternalLink, AlertCircle } from "lucide-react";
import Link from "next/link";
import { useLive } from "@/lib/use-fetch";
import { useToast } from "@/lib/use-toast";
import type { JiraTicket } from "@/lib/jira-client";
import { TodayCollapseButton } from "@/components/TodayCollapseButton";
import { SeverityPill, type SeverityTone } from "@/components/ui/Severity";
import { useGridSize } from "@/lib/use-grid-size";
import { QueueRow } from "@/components/ui/QueueRow";

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
  if (s.includes("qa")) return "violet";
  if (s.includes("progress") || s.includes("dev")) return "info";
  if (s.includes("review") || s.includes("change")) return "warning";
  if (s.includes("todo") || s.includes("backlog") || s.includes("to do") || s.includes("open")) return "muted";
  return "muted";
}

/** @deprecated Use statusTone + SeverityDot/SeverityPill instead. */
export function statusColor(status: string): string {
  const t = statusTone(status);
  const map: Record<SeverityTone, string> = {
    success: "var(--success)", critical: "var(--danger)", violet: "var(--violet)",
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

function formatUpdatedShort(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function JiraWidget({ collapsed = false, collapsedSummary, onToggle }: JiraWidgetProps) {
  const { data, error, isLoading } = useLive<JiraResponse>("/api/jira/tickets");
  const toast = useToast();
  const gridSize = useGridSize("jira");

  const sortedTickets = useMemo(() => {
    const list = data?.tickets ?? [];
    return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [data?.tickets]);

  const copyKey = useCallback(
    async (key: string) => {
      try {
        await navigator.clipboard.writeText(key);
        toast.success(`Copied ${key}`);
      } catch {
        toast.error("Couldn't copy to clipboard.");
      }
    },
    [toast],
  );

  if (isLoading) {
    return (
      <div className="skeleton" style={{ height: 100, borderRadius: "var(--radius)", marginTop: 8 }} />
    );
  }

  if (error) {
    return (
      <div
        className="card"
        style={{
          marginTop: 8,
          padding: "8px 12px",
          borderLeft: "3px solid var(--danger)",
          fontSize: 12,
          color: "var(--text-muted)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <AlertCircle size={12} style={{ color: "var(--danger)" }} aria-hidden />
        Couldn&apos;t reach Jira.
      </div>
    );
  }

  if (!data?.configured) return null;
  if (sortedTickets.length === 0) return null;

  return (
    <div className="card" data-collapsed={collapsed ? "true" : undefined} style={{ marginTop: "8px" }}>
      <div className="card-header today-grid-drag-handle">
        <span className="flex min-w-0 items-center gap-1.5">
          <Ticket size={12} aria-hidden /> My Tickets
        </span>
        <span className="flex min-w-0 items-center gap-2">
          {collapsed ? <span className="today-collapsed-summary">{collapsedSummary}</span> : null}
          <Link href="/tickets" className="text-xs today-grid-drag-cancel" style={{ color: "var(--accent)" }}>
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
              <div className="text-[11px]" style={{ color: "var(--text-subtle)" }}>
                {["critical", "warning", "info", "success"].map((tone) => {
                  const n = sortedTickets.filter((t) => statusTone(t.status) === tone).length;
                  return n > 0 ? `${n} ${tone === "info" ? "in dev" : tone === "warning" ? "in review" : tone === "critical" ? "blocked" : "done"}` : null;
                }).filter(Boolean).join(" · ") || "tickets"}
              </div>
            </div>
          ) : gridSize === "2x1" ? (
            <div role="list" aria-label="Your Jira tickets">
              {sortedTickets.slice(0, 4).map((t) => (
                <QueueRow
                  key={t.key}
                  monoKey={t.key}
                  title={t.summary}
                  statusPill={<SeverityPill tone={statusTone(t.status)}>{t.status}</SeverityPill>}
                  size="compact"
                  href={t.url}
                />
              ))}
              {sortedTickets.length > 4 && (
                <div className="px-3 py-1 text-[11px]" style={{ color: "var(--text-subtle)" }}>
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
                  className="jira-widget-ticket-row flex items-start gap-2 px-4 py-2.5 text-sm"
                  style={{
                    borderTop: i === 0 ? "none" : "1px solid var(--border-muted)",
                  }}
                >
                  <button
                    type="button"
                    className="jira-widget-key font-mono text-xs shrink-0 px-1.5 py-0.5 rounded mt-0.5"
                    style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}
                    onClick={() => void copyKey(t.key)}
                    title={`Copy ${t.key}`}
                    aria-label={`Copy issue key ${t.key}`}
                  >
                    {t.key}
                  </button>
                  <span
                    className="flex-1 min-w-[8rem] break-words leading-snug"
                    style={{ color: "var(--text)" }}
                    title={t.summary}
                  >
                    {t.summary}
                  </span>
                  <span className="jira-widget-meta flex shrink-0 items-center gap-2">
                    <span
                      className="text-[11px] shrink-0 tabular-nums text-right pt-0.5"
                      style={{ color: "var(--text-subtle)" }}
                      title={t.updatedAt ? `Updated ${new Date(t.updatedAt).toLocaleString()}` : undefined}
                    >
                      {formatUpdatedShort(t.updatedAt)}
                    </span>
                    <SeverityPill tone={statusTone(t.status)}>{t.status}</SeverityPill>
                    <a
                      href={t.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open ${t.key} in Jira`}
                      className="shrink-0 rounded p-1 transition-colors jira-widget-open mt-0.5"
                      style={{ color: "var(--text-subtle)" }}
                    >
                      <ExternalLink size={11} aria-hidden />
                    </a>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
