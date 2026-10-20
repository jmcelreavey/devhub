import type { JiraTicket } from "@/lib/jira/client";
import { matchesTaskSearch } from "@/lib/tasks/task-text";
import type { Task } from "@/lib/tasks/types";
import { cardMatchesFilters, filtersFromParams, type BoardCard, type BoardFilters } from "./notes-board-shared";
import { filterTickets } from "@/lib/jira/ticket-search";

export const STORYBOARD_VIEWS = [{ value: "board", label: "Board" }] as const;

export type StoryboardView = typeof STORYBOARD_VIEWS[number]["value"];

/** The Storyboard is the board alone; Jira and History have their own screens, and old links to the removed list view land here. */
export function storyboardView(): StoryboardView {
  return "board";
}

export function storyboardUrl(pathname: string, search: string, changes: Record<string, string | null>, hash = ""): string {
  const params = new URLSearchParams(search);
  for (const [key, value] of Object.entries(changes)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  return `${pathname}${params.size ? `?${params}` : ""}${hash}`;
}

export function workFilters(params: { get(name: string): string | null }): BoardFilters {
  const filters = filtersFromParams(params);
  if (!filters.parentJira && params.get("parent")) filters.parentJira = params.get("parent")!.trim();
  return filters;
}

export function matchesCardQuery(card: BoardCard, query: string): boolean {
  const haystack = [
    card.title, card.taskId, card.repo ?? "", card.date, card.status,
    ...card.tags.map((tag) => `#${tag}`), ...(card.jira ?? []), card.parentJira ?? "", ...card.summary,
    card.task?.text ?? "", card.task?.due ?? "", card.task?.abandonReason ?? "",
    ...(card.task?.links ?? []).flatMap((link) => [link.kind, link.id, link.label, link.href ?? ""]),
  ].join("\n").toLowerCase();
  return query.trim().toLowerCase().split(/\s+/).every((word) => haystack.includes(word));
}

export function taskMatchesWorkFilters(task: Task, filters: BoardFilters, card?: BoardCard, noteTags?: Record<string, string[]>): boolean {
  return cardMatchesFilters({
    repo: card?.repo ?? task.links?.find((link) => link.kind === "repo")?.id,
    tags: card?.tags ?? noteTags?.[task.id] ?? [],
    jira: card?.jira ?? [...new Set([...(task.jiraKey ? [task.jiraKey] : []), ...(task.links ?? []).filter((link) => link.kind === "jira").map((link) => link.id)])],
    parentJira: card?.parentJira,
  }, { ...filters, tag: undefined }) && (!filters.tag || matchesTaskSearch(task, `#${filters.tag.replace(/^#/, "")}`, { [task.id]: [...(noteTags?.[task.id] ?? []), ...(card?.tags ?? [])] }));
}

export function ticketMatchesWorkFilters(ticket: JiraTicket, filters: BoardFilters, linkedCards: readonly BoardCard[]): boolean {
  if (!cardMatchesFilters({ tags: [], jira: [ticket.key], parentJira: ticket.parent?.key }, { jira: filters.jira, parentJira: filters.parentJira })) return false;
  if (!filters.repo && !filters.tag) return true;
  return linkedCards.some((card) => card.jira?.some((key) => key.toUpperCase() === ticket.key.toUpperCase()) && cardMatchesFilters(card, { repo: filters.repo, tag: filters.tag }));
}

/** A ticket's own status, compared as Jira names it: tabs come from real statuses, not a made-up grouping. */
export function ticketMatchesStatusFilter(status: string, filter: string): boolean {
  return filter === "All" || status.trim().toLowerCase() === filter.trim().toLowerCase();
}

function statusRank(status: string): number {
  const value = status.toLowerCase();
  if (/\b(done|closed|resolved|released|complete)/.test(value)) return 9;
  if (/\b(open|to ?do|backlog|selected|new|ready)\b/.test(value)) return 0;
  if (/progress|doing|develop/.test(value)) return 1;
  if (/review|test|qa|verify/.test(value)) return 2;
  if (/paus|block|hold|wait/.test(value)) return 3;
  return 4;
}

/** "All", then each status that actually occurs among the tickets, in a natural workflow order, with its count. */
export function ticketStatusTabs(tickets: readonly { status: string }[]): Array<{ status: string; count: number }> {
  const counts = new Map<string, { status: string; count: number }>();
  for (const { status } of tickets) {
    const key = status.trim().toLowerCase();
    if (!key) continue;
    const entry = counts.get(key);
    if (entry) entry.count++; else counts.set(key, { status: status.trim(), count: 1 });
  }
  return [{ status: "All", count: tickets.length }, ...[...counts.values()].sort((left, right) => statusRank(left.status) - statusRank(right.status) || left.status.localeCompare(right.status))];
}

export function workViewTickets(tickets: readonly JiraTicket[], query: string, filters: BoardFilters, cards: readonly BoardCard[], status = "All", date?: string, attentionIds?: ReadonlySet<string>): JiraTicket[] {
  return filterTickets(tickets, query).filter((ticket) => ticketMatchesStatusFilter(ticket.status, status)
    && ticketMatchesWorkFilters(ticket, filters, cards)
    && (!date || ticket.updatedAt.startsWith(date))
    && (!attentionIds || cards.some((card) => attentionIds.has(card.taskId) && card.jira?.includes(ticket.key))));
}
