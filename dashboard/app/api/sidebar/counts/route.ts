import { NextResponse } from "next/server";
import { isTaskOpen, rolloverTasks } from "@/lib/tasks-storage";
import { getMyTickets } from "@/lib/jira-client";
import { fetchMyGithubPrs } from "@/lib/github-prs";
import { buildPrActivitySignature, buildTicketActivitySignature } from "@/lib/activity-signatures";
import { countStaleShares } from "@/lib/share/share-content";
import {
  getSidebarCountsCache,
  setSidebarCountsCache,
  SIDEBAR_COUNTS_TTL_MS,
  type SidebarCounts,
} from "@/lib/sidebar-counts-cache";

export type { SidebarCounts };

export async function GET() {
  const cached = getSidebarCountsCache();
  if (cached && Date.now() - cached.ts < SIDEBAR_COUNTS_TTL_MS) {
    return NextResponse.json(cached.data);
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

  setSidebarCountsCache(data);
  return NextResponse.json(data);
}
