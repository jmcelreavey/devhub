/**
 * Client-safe matching for the Jira tab's search box.
 *
 * No `node:` imports and no Jira env access — this only inspects the ticket
 * rows the API already returned.
 */
import type { JiraTicket } from "@/lib/jira/client";

function haystack(ticket: JiraTicket): string {
  return [
    ticket.key,
    ticket.summary,
    ticket.status,
    ticket.priority,
    ticket.issuetype,
    ticket.project,
    ticket.projectKey,
    ticket.assignee?.displayName ?? "",
    ticket.assignee?.email ?? "",
  ]
    .join("   ")
    .toLowerCase();
}

/** Whitespace-separated terms are AND-ed, so "PTF bug" narrows. */
export function matchesTicketSearch(ticket: JiraTicket, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay = haystack(ticket);
  return terms.every((t) => hay.includes(t));
}

export function filterTickets<T extends JiraTicket>(tickets: readonly T[], query: string): T[] {
  if (!query.trim()) return [...tickets];
  return tickets.filter((t) => matchesTicketSearch(t, query));
}
