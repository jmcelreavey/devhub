"use client";

import { useLive } from "@/lib/hooks/use-fetch";
import type { JiraTicketDetail } from "@/lib/jira/client";

/** URL keys share one ticket request across Home rows and sections. */
export function useJiraTicketStatus(key?: string) {
  const ticket = useLive<JiraTicketDetail>(key ? `/api/jira/ticket/${encodeURIComponent(key)}` : null, {
    shouldRetryOnError: false,
    // One request per linked ticket; statuses rarely change, and the pill refreshes after its own moves.
    refreshInterval: 300_000,
    dedupingInterval: 60_000,
    onError: () => undefined,
  });
  return { status: ticket.error ? undefined : ticket.data?.status?.name, refresh: ticket.mutate };
}
