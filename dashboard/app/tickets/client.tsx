"use client";

import { useState, useMemo } from "react";
import { Ticket, RefreshCw } from "lucide-react";
import { useLive } from "@/lib/hooks/use-fetch";
import type { JiraTicket } from "@/lib/jira/client";
import { useMarkTicketsSeen } from "@/lib/hooks/use-sidebar-counts";
import { priorityIcon } from "@/components/jira/JiraWidget";
import { JiraTicketRow } from "@/components/jira/JiraTicketRow";
import { FetchError, EmptyState, InlineSearch, SkeletonRows } from "@/components";
import { filterTickets } from "@/lib/jira/ticket-search";
import { BootScreen, useBootGate } from "@/components/today/TodayBootScreen";

interface JiraResponse {
  tickets?: JiraTicket[];
  configured?: boolean;
}

const STATUS_GROUPS = ["All", "To Do", "In Progress", "In Review", "Done"] as const;

function ticketMatchesStatusFilter(status: string, filter: string): boolean {
  const s = status.toLowerCase();
  const f = filter.toLowerCase();
  if (f === "in review") {
    return s.includes("review");
  }
  return s.includes(f);
}

function TicketCard({ ticket }: { ticket: JiraTicket }) {
  return (
    <div className="card" style={{ padding: "8px 10px" }}>
      <div className="flex items-start gap-2">
        <span className="text-xs mt-1.5" aria-hidden>
          {priorityIcon(ticket.priority)}
        </span>
        <div className="min-w-0 flex-1">
          <JiraTicketRow ticket={ticket} density="comfortable" />
          <p className="px-1 text-xs text-text-subtle">
            {ticket.project} ({ticket.projectKey}) · {ticket.priority} · {ticket.issuetype}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function TicketsPage() {
  const { data, error, isLoading, mutate, isValidating } = useLive<JiraResponse>("/api/jira/tickets");
  const boot = useBootGate(data !== undefined || !!error);
  const [filter, setFilter] = useState<string>("All");
  const [query, setQuery] = useState("");

  const tickets = useMemo(() => {
    const list = data?.tickets ?? [];
    return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [data?.tickets]);
  useMarkTicketsSeen();
  const configured = data?.configured ?? false;

  const byStatus =
    filter === "All" ? tickets : tickets.filter((t) => ticketMatchesStatusFilter(t.status, filter));
  const filtered = filterTickets(byStatus, query);

  if (!isLoading && !error && !configured) {
    return (
      <div className="page-wrapper">
      <BootScreen state={boot} />
        <div className="page-header">
          <div className="page-title">Tickets</div>
        </div>
        <EmptyState
          icon={<Ticket size={28} />}
          title="No Jira connection."
          subtitle={
            <>
              Set <code>JIRA_DOMAIN</code>, <code>JIRA_EMAIL</code>, and <code>JIRA_API_TOKEN</code> in{" "}
              <code>.env.local</code>.
            </>
          }
        />
      </div>
    );
  }

  return (
    <div className="page-wrapper">
      <BootScreen state={boot} />
      <div className="page-header">
        <div className="page-title">Tickets</div>
        <div className="flex items-center gap-2">
          <span className="badge badge-muted">{tickets.length}</span>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: "12px", padding: "4px 10px" }}
            onClick={() => mutate()}
            disabled={isValidating}
            aria-label="Refresh tickets"
          >
            <RefreshCw size={12} className={isValidating ? "animate-spin" : ""} aria-hidden />
          </button>
        </div>
      </div>

      {error && <FetchError message="Couldn't reach Jira." onRetry={() => mutate()} />}

      {/* Status filter tabs */}
      <div className="flex gap-1 mb-4" style={{ borderBottom: "1px solid var(--border-muted)" }}>
        {STATUS_GROUPS.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setFilter(g)}
            className="px-3 py-2 text-xs font-medium transition-colors"
            style={{
              color: filter === g ? "var(--text)" : "var(--text-muted)",
              borderBottom: filter === g ? "2px solid var(--accent)" : "2px solid transparent",
              background: "none",
              cursor: "pointer",
              marginBottom: "-1px",
            }}
            aria-pressed={filter === g}
          >
            {g}
          </button>
        ))}
      </div>

      <div className="card mb-4" style={{ padding: "8px 10px" }}>
        <InlineSearch
          id="tickets-search"
          label="Search tickets"
          placeholder="Search by key, summary, status, project or assignee…"
          value={query}
          onChange={setQuery}
          hint={query.trim() ? `${filtered.length} of ${byStatus.length}` : undefined}
        />
      </div>

      {isLoading && !data && <SkeletonRows count={5} height={40} variant="list" />}

      <div className="space-y-2">
        {filtered.map((t) => (
          <TicketCard key={t.key} ticket={t} />
        ))}
      </div>

      {!isLoading && !error && filtered.length === 0 && configured && (
        <EmptyState
          title={
            query.trim()
              ? `No tickets match \u201C${query.trim()}\u201D.`
              : filter === "All"
                ? "No tickets assigned to you."
                : `No ${filter.toLowerCase()} tickets.`
          }
          quips={
            !query.trim() && filter === "All"
              ? ["Suspiciously quiet.", "Enjoy it while it lasts.", "The board owes you nothing today."]
              : undefined
          }
        />
      )}
    </div>
  );
}
