import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { extractTags, mergeEntityRefs } from "@/lib/entity-note";
import { resolveEntityLinks } from "@/lib/entity-links/resolve";
import { getEventsInRange } from "@/lib/google-calendar";
import { getMyTicketsCached } from "@/lib/jira/client";
import { getNoteIndex } from "@/lib/notes/note-index";
import { loadIndex } from "@/lib/recall/store";
import { resolveCanonicalRepoFullName, rowFromSearchItem, searchIssues } from "@/lib/github/prs";
import { getGithubFullNameForLocalRepo } from "@/lib/repos";
import {
  clusterRepoWork,
  HUB_CALENDAR_WINDOW_DAYS,
  isJiraInProgress,
  noteBelongsToRepo,
  taskBelongsToRepo,
  type WorkHubNote,
  type WorkHubPr,
  type WorkHubTask,
} from "@/lib/repos/work-hub";
import { resolveScannedRepo } from "@/lib/scanned-repo";
import { isTaskOpen, listTaskDays, rolloverTasks } from "@/lib/tasks/storage";
import type { Task } from "@/lib/tasks/types";
import { todayISO } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Finished work stays out of the live model; the hub shows it in its own archive. */
const DONE_TASK_LIMIT = 200;

/**
 * An optional integration must not take the whole hub down, but a broken one
 * must not masquerade as "nothing to show" either — the caller reports which
 * source failed so the UI can say so instead of rendering a bare empty state.
 */
async function settle<T>(promise: Promise<T>): Promise<{ data?: T; error?: string }> {
  try {
    return { data: await promise };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Cap: a cluster shows a handful of PRs, and this is on the page's critical path. */
const OPEN_PR_LIMIT = 50;

/**
 * Open PRs for the repo, shaped for `clusterRepoWork`.
 *
 * Clustering matches a task's `pr` ref by URL or by `owner/repo#number`, so both
 * must survive the mapping.
 */
async function openPrsForRepo(fullName: string | null): Promise<WorkHubPr[]> {
  if (!fullName) return [];
  const items = await searchIssues(`repo:${fullName} is:pr is:open`, OPEN_PR_LIMIT);
  return items.map(rowFromSearchItem).map((row) => ({
    url: row.url,
    title: row.title,
    repo: row.repo,
    number: row.number,
  }));
}

function finishedTasksForRepo(name: string, fullName: string | null): WorkHubTask[] {
  const out: WorkHubTask[] = [];
  for (const day of listTaskDays()) {
    for (const task of day.tasks) {
      if (isTaskOpen(task) || task.movedAt) continue;
      if (!taskBelongsToRepo(task, name, fullName)) continue;
      out.push(asFinishedTask(task, day.date));
      if (out.length >= DONE_TASK_LIMIT) return out;
    }
  }
  return out;
}

function asFinishedTask(task: Task, date: string): WorkHubTask {
  return {
    id: task.id,
    text: task.text,
    date,
    createdAt: task.createdAt,
    jiraKey: task.jiraKey,
    links: task.links,
    finishedAt: task.completedAt ?? task.abandonedAt,
    abandoned: Boolean(task.abandonedAt),
    abandonReason: task.abandonReason,
  };
}

function recallNotesForRepo(name: string): WorkHubNote[] {
  const index = loadIndex();
  if (!index) return [];
  const key = `repo:${name}`;
  const notes = new Map<string, WorkHubNote>();
  for (const chunk of index.chunks) {
    if (!chunk.refs.includes(key)) continue;
    if (chunk.sourceKind !== "note" && chunk.sourceKind !== "learning") continue;
    const existing = notes.get(chunk.sourceId);
    if (existing) {
      if (chunk.ts > (existing.ts ?? 0)) existing.ts = chunk.ts;
      continue;
    }
    notes.set(chunk.sourceId, {
      slug: chunk.sourceId,
      href: chunk.href ?? `/notes/${chunk.sourceId}`,
      title: chunk.title.split(" — ")[0],
      ts: chunk.ts,
    });
  }
  return [...notes.values()];
}

function notesForRepo(name: string, fullName: string | null): WorkHubNote[] {
  const notes = new Map<string, WorkHubNote>();
  for (const note of recallNotesForRepo(name)) notes.set(note.slug, note);
  for (const note of getNoteIndex().notes) {
    if (!noteBelongsToRepo(note, name, fullName)) continue;
    const existing = notes.get(note.slug);
    if (existing) {
      existing.ts = Math.max(existing.ts ?? 0, note.modified);
      if (!existing.title) existing.title = note.title;
      continue;
    }
    notes.set(note.slug, {
      slug: note.slug,
      href: note.href,
      title: note.title,
      ts: note.modified,
    });
  }
  return [...notes.values()];
}

function jiraKeysOnTask(task: { jiraKey?: string; links?: Array<{ kind: string; id: string }> }): string[] {
  const keys = new Set<string>();
  if (task.jiraKey?.trim()) keys.add(task.jiraKey.trim().toUpperCase());
  for (const link of task.links ?? []) {
    if (link.kind === "jira" && link.id.trim()) keys.add(link.id.trim().toUpperCase());
  }
  return [...keys];
}

export const GET = withErrorHandler(
  async (_req: Request, { params }: { params: Promise<{ name: string }> }) => {
    const { name } = await params;
    const repoPath = resolveScannedRepo(name);
    if (!repoPath) {
      return NextResponse.json({ error: "Repo not found" }, { status: 404 });
    }

    const remoteFullName = getGithubFullNameForLocalRepo(repoPath);
    const fullName = remoteFullName ? await resolveCanonicalRepoFullName(remoteFullName) : null;
    const date = todayISO();
    // Tasks are local; Jira, Calendar and GitHub are independent network calls.
    // Awaiting them in sequence made this route cost the sum of all four on the
    // repo page's critical path.
    const [rolled, ticketsResult, eventsResult, prsResult] = await Promise.all([
      rolloverTasks(),
      settle(getMyTicketsCached()),
      settle(getEventsInRange(HUB_CALENDAR_WINDOW_DAYS, HUB_CALENDAR_WINDOW_DAYS)),
      settle(openPrsForRepo(fullName)),
    ]);
    const tasks = rolled.filter(isTaskOpen).map((task) => ({
      ...task,
      date,
    }));
    const tickets = ticketsResult.data ?? [];
    const rawEvents = eventsResult.data ?? [];
    const notes = notesForRepo(name, fullName);

    const belonging = tasks.filter((task) => taskBelongsToRepo(task, name, fullName));
    const clusteredKeys = new Set(belonging.flatMap(jiraKeysOnTask));

    const tasksForHub = tasks.map((task) => {
      if (!taskBelongsToRepo(task, name, fullName)) return task;
      const hops = resolveEntityLinks("task", task.id, { date: task.date, label: task.text });
      return { ...task, links: mergeEntityRefs([...(task.links ?? []), ...hops.notes]) };
    });

    // In-progress plus any ticket already tied to a repo-linked/tagged task (Open hops).
    const jiraHops = tickets
      .filter(
        (ticket) =>
          isJiraInProgress(ticket.status) || clusteredKeys.has(ticket.key.toUpperCase()),
      )
      .map((ticket) => {
        const links = resolveEntityLinks("jira", ticket.key);
        return { key: ticket.key, related: links.related, notes: links.notes };
      });

    const model = clusterRepoWork({
      repoName: name,
      fullName,
      tasks: tasksForHub,
      tickets: tickets.map((ticket) => ({
        key: ticket.key,
        summary: ticket.summary,
        status: ticket.status,
        url: ticket.url,
        updatedAt: ticket.updatedAt,
      })),
      notes,
      prs: prsResult.data ?? [],
      events: rawEvents.map((event) => {
        const eventDate = event.start.slice(0, 10) || undefined;
        const related = resolveEntityLinks("calendar", event.id, {
          meetingTitle: event.title,
          date: eventDate,
          label: event.title,
        }).related;
        const tags = new Set(extractTags(event.title));
        for (const ref of related) {
          if (ref.kind === "tag") tags.add(ref.id.toLowerCase());
        }
        return {
          id: event.id,
          title: event.title,
          start: event.start,
          end: event.end,
          htmlLink: event.htmlLink,
          tags: [...tags],
          links: related.filter((ref) => ref.kind === "repo" || ref.kind === "tag"),
        };
      }),
      jiraHops,
    });

    const degraded = [
      ticketsResult.error ? { source: "Jira" as const, message: ticketsResult.error } : null,
      eventsResult.error ? { source: "Calendar" as const, message: eventsResult.error } : null,
      prsResult.error ? { source: "GitHub" as const, message: prsResult.error } : null,
    ].filter((entry) => entry !== null);

    return NextResponse.json({
      date,
      fullName,
      model,
      doneTasks: finishedTasksForRepo(name, fullName),
      ...(degraded.length > 0 ? { degraded } : {}),
    });
  },
  "repos.work",
);
