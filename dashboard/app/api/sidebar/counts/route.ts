import { NextResponse } from "next/server";
import { isTaskOpen, rolloverTasks } from "@/lib/tasks-storage";
import { getMyTickets } from "@/lib/jira-client";
import { fetchMyGithubPrs } from "@/lib/github-prs";
import { buildPrActivitySignature, buildTicketActivitySignature } from "@/lib/activity-signatures";
import { countStaleShares } from "@/lib/share/share-content";

export interface SidebarCounts {
  tasks: number;
  tickets: number;
  prs: number;
  /** Live links whose source has drifted (Live → Stale). */
  shared: number;
  signatures: {
    tickets: string;
    prs: string;
  };
}

// Reuse a short cache so rapid navigation doesn't hammer the sub-APIs.
let cache: { data: SidebarCounts; ts: number } | null = null;
const TTL = 60_000;

export async function GET() {
  if (cache && Date.now() - cache.ts < TTL) {
    return NextResponse.json(cache.data);
  }

  const [tasks, tickets, prs] = await Promise.allSettled([
    rolloverTasks(),
    process.env.JIRA_DOMAIN ? getMyTickets() : Promise.resolve([]),
    fetchMyGithubPrs().catch(() => ({ authored: [], reviews: [] })),
  ]);

  const taskList = tasks.status === "fulfilled" ? tasks.value : [];
  const ticketList = tickets.status === "fulfilled" ? tickets.value : [];
  const { authored = [], reviews = [] } = prs.status === "fulfilled" ? prs.value : {};

  const openTasks = taskList.filter(isTaskOpen).length;
  const openTickets = ticketList.length;
  const reviewsRequested = reviews.length;

  let staleShares = 0;
  try {
    staleShares = countStaleShares();
  } catch {
    staleShares = 0;
  }

  const data: SidebarCounts = {
    tasks: openTasks,
    tickets: openTickets,
    prs: authored.length + reviewsRequested,
    shared: staleShares,
    signatures: {
      tickets: buildTicketActivitySignature(ticketList),
      prs: buildPrActivitySignature([authored, reviews]),
    },
  };

  cache = { data, ts: Date.now() };
  return NextResponse.json(data);
}
