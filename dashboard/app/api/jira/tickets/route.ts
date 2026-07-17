import { NextResponse } from "next/server";
import { getMyTickets } from "@/lib/jira-client";
import {
  getJiraTicketsCache,
  setJiraTicketsCache,
  JIRA_TICKETS_TTL_MS,
} from "@/lib/jira-tickets-cache";

export async function GET() {
  if (!process.env.JIRA_DOMAIN) {
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
}
