"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Ticket, RefreshCw } from "lucide-react";
import { useLive } from "@/lib/hooks/use-fetch";
import type { JiraTicket } from "@/lib/jira/client";
import { useMarkTicketsSeen } from "@/lib/hooks/use-sidebar-counts";
import ticketStyles from "@/components/jira/JiraTicketRow.module.css";
import { JiraTicketRow } from "@/components/jira/JiraTicketRow";
import { FetchError, EmptyState, InlineSearch, SkeletonRows } from "@/components";
import { BootScreen, useBootGate } from "@/components/today/TodayBootScreen";
import { ticketMatchesStatusFilter, ticketStatusTabs, workViewTickets } from "@/lib/storyboard/view-state";
import type { BoardCard, BoardFilters } from "@/lib/storyboard/notes-board-shared";

const NO_FILTERS: BoardFilters = {};
const NO_CARDS: readonly BoardCard[] = [];

interface JiraResponse {
  tickets?: JiraTicket[];
  configured?: boolean;
}

export default function TicketsPage({ embedded = false, query: sharedQuery, filters = NO_FILTERS, cards = NO_CARDS, date, attentionIds, statusFilter, onStatusFilterChange }: {
  embedded?: boolean;
  query?: string;
  filters?: BoardFilters;
  cards?: readonly BoardCard[];
  date?: string;
  attentionIds?: ReadonlySet<string>;
  statusFilter?: string;
  onStatusFilterChange?: (status: string) => void;
} = {}) {
  const { data, error, isLoading, mutate, isValidating } = useLive<JiraResponse>("/api/jira/tickets");
  const boot = useBootGate(data !== undefined || !!error);
  const [localFilter, setLocalFilter] = useState<string>("All");
  const filter = statusFilter ?? localFilter;
  const setFilter = onStatusFilterChange ?? setLocalFilter;
  const [localQuery, setQuery] = useState("");
  const query = sharedQuery ?? localQuery;
  const Heading = embedded ? "h2" : "h1";

  const tickets = useMemo(() => {
    const list = data?.tickets ?? [];
    return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [data?.tickets]);
  useMarkTicketsSeen();
  const configured = data?.configured ?? false;

  const statusTabs = ticketStatusTabs(tickets);
  const byStatus =
    filter === "All" ? tickets : tickets.filter((t) => ticketMatchesStatusFilter(t.status, filter));
  const filtered = workViewTickets(tickets, query, filters, cards, filter, date, attentionIds);

  if (!isLoading && !error && !configured) {
    return (
      <div className={embedded ? undefined : "page-wrapper"}>
      {!embedded ? <BootScreen state={boot} /> : null}
        <div className="page-header">
          <Heading className="page-title">Jira</Heading>
        </div>
        <EmptyState
          icon={<Ticket size={28} />}
          title="No Jira connection."
          subtitle={
            <>
              Connect Jira in <Link href="/setup" className="text-accent hover:underline">Setup</Link> to see your tickets.
            </>
          }
        />
      </div>
    );
  }

  return (
    <div className={embedded ? undefined : "page-wrapper"}>
      {!embedded ? <BootScreen state={boot} /> : null}
      <div className="page-header">
        <Heading className="page-title">{embedded ? "Jira" : "Tickets"}</Heading>
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

      {error && (
        <FetchError
          message={
            /authentication failed/i.test(error.message)
              ? "Jira authentication failed. Mint a new API token and paste it in /setup."
              : "Couldn't reach Jira."
          }
          onRetry={() => mutate()}
        />
      )}

      {/* Status filter tabs */}
      <div className="flex flex-wrap gap-1 mb-4" style={{ borderBottom: "1px solid var(--border-muted)" }}>
        {statusTabs.map(({ status: g, count }) => (
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
            {g} <span className="text-text-subtle">{count}</span>
          </button>
        ))}
      </div>

      {sharedQuery === undefined ? <div className="mb-4">
        <InlineSearch
          id="tickets-search"
          label="Search tickets"
          placeholder="Search by key, summary, status, project or assignee…"
          value={query}
          onChange={setQuery}
          hint={query.trim() ? `${filtered.length} of ${byStatus.length}` : undefined}
        />
      </div> : null}

      {isLoading && !data && <SkeletonRows count={5} height={40} variant="list" />}

      {filtered.length > 0 && (
        <div className={`card ${ticketStyles.list}`} role="list" aria-label="Jira tickets">
          {filtered.map((t) => (
            <JiraTicketRow key={t.key} ticket={t} density="comfortable" showAssignee={false} showDetails boardIntake={embedded} />
          ))}
        </div>
      )}

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
