import { NextResponse } from "next/server";
import { getMyTickets } from "@/lib/jira-client";

let cache: { data: unknown; ts: number } | null = null;
const TTL = 2 * 60 * 1000;

export async function GET() {
  if (!process.env.JIRA_DOMAIN) {
    return NextResponse.json({ tickets: [], configured: false });
  }

  if (cache && Date.now() - cache.ts < TTL) {
    return NextResponse.json({ tickets: cache.data, cached: true, configured: true });
  }

  try {
    const tickets = await getMyTickets();
    cache = { data: tickets, ts: Date.now() };
    return NextResponse.json({ tickets, cached: false, configured: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Jira fetch failed", configured: true },
      { status: 500 }
    );
  }
}
