import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { jiraScreen } from "@/lib/integrations/screen-data";
const getMyTickets = jiraScreen.tickets;
import { getResolvedJiraEnv } from "@/lib/jira/env";
import {
  getJiraTicketsCache,
  setJiraTicketsCache,
  JIRA_TICKETS_TTL_MS,
} from "@/lib/jira/tickets-cache";

export const GET = withErrorHandler<[request?: Request]>(async () => {
  if (!getResolvedJiraEnv()) {
    return NextResponse.json({ tickets: [], configured: false });
  }

  const cached = getJiraTicketsCache();
  if (cached && Date.now() - cached.ts < JIRA_TICKETS_TTL_MS) {
    return NextResponse.json({ tickets: cached.data, cached: true, configured: true });
  }

  try {
    const tickets = await getMyTickets();
    setJiraTicketsCache(tickets);
    return NextResponse.json({ tickets, cached: false, configured: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Jira fetch failed", configured: true },
      { status: 500 },
    );
  }
}, "jira.tickets.get");
