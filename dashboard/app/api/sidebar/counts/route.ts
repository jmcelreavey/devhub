import { NextResponse } from "next/server";
import { getTasks, isTaskOpen, ensureTasksMigrated } from "@/lib/tasks/storage";
import { getMyTickets } from "@/lib/jira/client";
import { fetchMyGithubPrs } from "@/lib/github/prs";
import { buildPrActivitySignature, buildTicketActivitySignature } from "@/lib/activity-signatures";
import { countStaleShares } from "@/lib/share/share-content";
import { withErrorHandler } from "@/lib/api-utils";
import { activeTaskProfile, taskProfileConflict } from "@/lib/tasks/profile-request";
import { homeNeedsAction, homeWorkSummary } from "@/lib/storyboard/home-summary";
import { readNotesBoard } from "@/lib/storyboard/notes-board";
import { listWorkflows } from "@/lib/workflows/store";
import { actionablePrCount } from "@/lib/github/actionable-prs";
import { readGithubPrsListCache } from "@/lib/github/prs";
import { listOwnedRepos } from "@/lib/ownership/owned-repos";
import {
  getSidebarCountsCache,
  setSidebarCountsCache,
  SIDEBAR_COUNTS_TTL_MS,
  type SidebarCounts,
} from "@/lib/sidebar-counts-cache";

export type { SidebarCounts };

export const GET = withErrorHandler<[request?: Request]>(async () => {
  const profile = activeTaskProfile();
  const cached = getSidebarCountsCache(profile);
  if (cached && Date.now() - cached.ts < SIDEBAR_COUNTS_TTL_MS) {
    return NextResponse.json(cached.data);
  }

  const migrated = ensureTasksMigrated();
  const [tasks, tickets, prs, work] = await Promise.allSettled([
    migrated.then(() => getTasks()),
    process.env.JIRA_DOMAIN ? getMyTickets() : Promise.resolve([]),
    Promise.resolve().then(() => readGithubPrsListCache() ?? fetchMyGithubPrs()),
    migrated.then(() => {
      const board = readNotesBoard();
      if (board.errors.length) throw new Error("Task sources unavailable");
      const byId = new Map(board.cards.map((card) => [card.taskId, card]));
      const items = listWorkflows().flatMap((workflow) => {
        const card = byId.get(workflow.taskId);
        return card?.task ? [{ task: card.task, workflow }] : [];
      });
      return { board, items };
    }),
  ]);

  const conflict = taskProfileConflict(profile);
  if (conflict) return conflict;

  const taskList = tasks.status === "fulfilled" ? tasks.value : [];
  const ticketList = tickets.status === "fulfilled" ? tickets.value : [];
  const { authored = [], reviews = [], feedbackPrs = [] } = prs.status === "fulfilled" ? prs.value : {};
  const ownedRepos = listOwnedRepos().map((repo) => repo.fullName);
  const actionablePrsKnown = prs.status === "fulfilled" && authored.every((pr) => pr.checks !== undefined);

  const openTasks = tasks.status === "fulfilled" ? taskList.filter(isTaskOpen).length : cached?.data.tasks ?? 0;
  const openTickets = tickets.status === "fulfilled" ? ticketList.length : cached?.data.tickets ?? 0;
  const reviewsRequested = reviews.length;

  let staleShares = 0;
  try {
    staleShares = countStaleShares();
  } catch {
    staleShares = 0;
  }

  const summary = work.status === "fulfilled" ? homeWorkSummary(work.value.board.cards, work.value.items, reviews, Date.parse(work.value.board.generatedAt), authored, ownedRepos, feedbackPrs) : undefined;
  // The Home badge counts exactly Home's "Needs action" list; PRs waiting on you are counted on the PRs tab instead.
  const needsYou = summary ? homeNeedsAction(summary).length : undefined;
  const data: SidebarCounts = {
    reviewRequested: summary?.["review-requested"].length ?? null,
    blockedWork: summary?.blocked.length ?? null,
    tasks: openTasks,
    tickets: openTickets,
    prs: prs.status === "fulfilled" ? authored.length + reviewsRequested : cached?.data.prs ?? 0,
    shared: staleShares,
    actionablePrs: actionablePrsKnown ? actionablePrCount(authored, reviews, ownedRepos) : cached?.data.actionablePrs ?? null,
    needsYou: needsYou ?? cached?.data.needsYou ?? null,
    profile,
    updatedAt: new Date().toISOString(),
    unavailable: [tasks.status === "rejected" || work.status === "rejected" ? "tasks" : "", tickets.status === "rejected" ? "jira" : "", !actionablePrsKnown ? "github" : ""].filter(Boolean),
    signatures: {
      tickets: tickets.status === "fulfilled" ? buildTicketActivitySignature(ticketList) : cached?.data.signatures.tickets ?? "",
      prs: prs.status === "fulfilled" ? buildPrActivitySignature([authored, reviews]) : cached?.data.signatures.prs ?? "",
    },
  };

  setSidebarCountsCache(data, profile);
  return NextResponse.json(data);
}, "sidebar.counts.get");
