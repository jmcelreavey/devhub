import { sidebarCounts } from "../../../../../../../packages/shared/actions/misc-ui";
import { getTasks, isTaskOpen, ensureTasksMigrated } from "../../../../domains/tasks/storage";
import { getMyTickets } from "../../../../lib/jira/client";
import { fetchMyGithubPrs } from "../../../../lib/github/prs";
import { buildPrActivitySignature, buildTicketActivitySignature } from "../../../../lib/activity/activity-signatures";
import { countStaleShares } from "../../../../lib/share/share-content";
import { withErrorHandler } from "../../../../lib/api-utils";
import { activeTaskProfile, taskProfileConflict } from "../../../../domains/tasks/profile-request";
import { homeWorkSummary } from "../../../../../../../packages/shared/ui-lib/storyboard/home-summary";
import { readNotesBoard } from "../../../../lib/storyboard/notes-board";
import { listWorkflows } from "../../../../lib/workflows/store";
import { actionablePrCount } from "../../../../../../../packages/shared/ui-lib/github/actionable-prs";
import { readGithubPrsListCache } from "../../../../lib/github/prs";
import { listOwnedRepos } from "../../../../lib/ownership/owned-repos";
import { emitCoreEvent } from "@devhub/core/events/core-events";
import {
  getSidebarCountsCache,
  setSidebarCountsCache,
  SIDEBAR_COUNTS_TTL_MS,
  type SidebarCounts,
} from "../../../../lib/activity/sidebar-counts-cache";

export type { SidebarCounts };

type RemoteSnapshot = {
  tickets: PromiseSettledResult<Awaited<ReturnType<typeof getMyTickets>>>;
  prs: PromiseSettledResult<Awaited<ReturnType<typeof fetchMyGithubPrs>>>;
};
const remoteSnapshots = new Map<string, RemoteSnapshot>();
const remoteRequests = new Map<string, Promise<RemoteSnapshot>>();

function refreshRemote(profile: string): Promise<RemoteSnapshot> {
  const existing = remoteRequests.get(profile);
  if (existing) return existing;
  const request = Promise.allSettled([
    process.env.JIRA_DOMAIN ? getMyTickets() : Promise.resolve([]),
    Promise.resolve().then(() => readGithubPrsListCache() ?? fetchMyGithubPrs()),
  ] as const).then(([tickets, prs]) => {
    const next = { tickets, prs };
    if (!taskProfileConflict(profile)) {
      const previous = remoteSnapshots.get(profile);
      remoteSnapshots.set(profile, next);
      if (!previous || JSON.stringify(previous) !== JSON.stringify(next)) emitCoreEvent("board");
    }
    return next;
  }).finally(() => remoteRequests.delete(profile));
  remoteRequests.set(profile, request);
  return request;
}

export const GET = withErrorHandler<[request: Request]>(async (request) => {
  const profile = activeTaskProfile();
  const input = sidebarCounts.input.parse({ scope: new URL(request.url).searchParams.get("scope") });
  return await sidebarCounts.handler(input, { execute: ({ scope }) => readCounts(profile, scope) }) as Response;
}, "sidebar.counts.get");

async function readCounts(profile: string, scope: ReturnType<typeof sidebarCounts.input.parse>["scope"]) {
  const cached = getSidebarCountsCache(profile);
  if (scope === "external") {
    await refreshRemote(profile);
    return taskProfileConflict(profile) ?? Response.json({ ok: true });
  }
  if (scope !== "local" && cached && Date.now() - cached.ts < SIDEBAR_COUNTS_TTL_MS) {
    return Response.json(cached.data);
  }

  const migrated = ensureTasksMigrated();
  const [local, remote] = await Promise.all([
    Promise.allSettled([
    migrated.then(() => getTasks()),
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
    ] as const),
    scope === "local" ? remoteSnapshots.get(profile) ?? refreshRemote(profile) : refreshRemote(profile),
  ]);
  const [tasks, work] = local;
  const { tickets, prs } = remote;

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
  const data: SidebarCounts = {
    reviewRequested: summary?.["review-requested"].length ?? null,
    blockedWork: summary?.blocked.length ?? null,
    tasks: openTasks,
    tickets: openTickets,
    prs: prs.status === "fulfilled" ? authored.length + reviewsRequested : cached?.data.prs ?? 0,
    shared: staleShares,
    actionablePrs: actionablePrsKnown ? actionablePrCount(authored, reviews, ownedRepos) : cached?.data.actionablePrs ?? null,
    needsYou: null,
    profile,
    updatedAt: new Date().toISOString(),
    nextChangeAt: work.status === "fulfilled" ? work.value.board.nextChangeAt : undefined,
    generatedAt: work.status === "fulfilled" ? work.value.board.generatedAt : undefined,
    unavailable: [tasks.status === "rejected" || work.status === "rejected" ? "tasks" : "", tickets.status === "rejected" ? "jira" : "", !actionablePrsKnown ? "github" : ""].filter(Boolean),
    signatures: {
      tickets: tickets.status === "fulfilled" ? buildTicketActivitySignature(ticketList) : cached?.data.signatures.tickets ?? "",
      prs: prs.status === "fulfilled" ? buildPrActivitySignature([authored, reviews]) : cached?.data.signatures.prs ?? "",
    },
  };

  setSidebarCountsCache(data, profile);
  return Response.json(data);
}
