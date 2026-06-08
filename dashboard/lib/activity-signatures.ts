export interface TicketActivityItem {
  key: string;
}

export interface PrActivityItem {
  number: number;
  repo: string;
  url: string;
}

function stableSignature(parts: readonly string[]): string {
  return parts.filter(Boolean).sort().join("\n");
}

export function ticketActivityItemKey(ticket: TicketActivityItem): string {
  return ticket.key;
}

export function prActivityItemKey(row: PrActivityItem): string {
  return row.url || `${row.repo}#${row.number}`;
}

export function buildTicketActivitySignature(tickets: readonly TicketActivityItem[]): string {
  return stableSignature(tickets.map(ticketActivityItemKey));
}

export function buildPrActivitySignature(groups: readonly (readonly PrActivityItem[])[]): string {
  return stableSignature(
    groups.flatMap((rows) => rows.map(prActivityItemKey)),
  );
}
