import { extractTags, type EntityRef } from "../entity-note";
import { repoLinkMatches } from "./repo-link-match";

export interface WorkHubTask {
  id: string;
  text: string;
  date: string;
  createdAt?: string;
  jiraKey?: string;
  links?: EntityRef[];
  /** Archive rows only: ISO of completion/abandonment. */
  finishedAt?: string;
  abandoned?: boolean;
  abandonReason?: string;
}

export interface WorkHubTicket {
  key: string;
  summary: string;
  status: string;
  url: string;
  /** ISO from Jira `updated` — open-ticket lists sort on this. */
  updatedAt?: string;
}

export interface WorkHubNote {
  slug: string;
  title: string;
  href: string;
  /** Epoch ms (note mtime). Newest-first lists use this. */
  ts?: number;
}

export interface WorkHubPr {
  url: string;
  title: string;
  repo: string;
  number: number;
}

export interface WorkHubEvent {
  id: string;
  title: string;
  start: string;
  end?: string;
  htmlLink?: string;
  /** Lowercase #tags from the title / meeting note. */
  tags?: string[];
  links?: EntityRef[];
}

export interface JiraHop {
  key: string;
  related: EntityRef[];
  notes: EntityRef[];
}

export interface WorkCluster {
  id: string;
  inProgress: boolean;
  jira?: WorkHubTicket;
  tasks: WorkHubTask[];
  notes: WorkHubNote[];
  prs: WorkHubPr[];
  calendar: WorkHubEvent[];
}

export interface WorkHubModel {
  clusters: WorkCluster[];
  leftoverTasks: WorkHubTask[];
  leftoverNotes: WorkHubNote[];
  leftoverPrs: WorkHubPr[];
  leftoverEvents: WorkHubEvent[];
  /** Open (not-done, not in-progress) tickets associated with this repo. */
  openTickets: WorkHubTicket[];
}

/** Upcoming + recent: last N days through next N days. */
export const HUB_CALENDAR_WINDOW_DAYS = 14;
export const HUB_NOTES_PREVIEW = 8;
export const HUB_LONG_LIST_PREVIEW = 20;

const DAY_MS = 86_400_000;

export function isJiraInProgress(status: string): boolean {
  return /in progress/i.test(status.trim());
}

export function isJiraDone(status: string): boolean {
  return /^(done|resolved|closed|cancelled|canceled|won't do|won't fix)$/i.test(status.trim());
}

export function taskLinksRepo(
  task: { links?: EntityRef[] },
  repoName: string,
  fullName: string | null,
  aliases: readonly string[] = [],
): boolean {
  return (task.links ?? []).some(
    (link) => link.kind === "repo" && repoLinkMatches(link.id, repoName, fullName, aliases),
  );
}

/** Today writes `kind=repo` entity-links; free-form `#repo` tags also count. */
export function taskBelongsToRepo(
  task: { text?: string; links?: EntityRef[] },
  repoName: string,
  fullName: string | null,
  aliases: readonly string[] = [],
): boolean {
  if (taskLinksRepo(task, repoName, fullName, aliases)) return true;
  return extractTags(task.text ?? "").some((tag) =>
    repoLinkMatches(tag, repoName, fullName, aliases),
  );
}

/**
 * This-repo notes: vault path `projects/<repo>` (prefix before `-` or `/`),
 * a path segment equal to the repo name, or a `#repo` tag in the title.
 */
export function noteBelongsToRepo(
  note: { slug: string; title?: string },
  repoName: string,
  fullName: string | null = null,
): boolean {
  const slug = note.slug.replace(/\\/g, "/");
  const lower = slug.toLowerCase();
  const repo = repoName.toLowerCase();
  const prefix = `projects/${repo}`;
  if (lower === prefix || lower.startsWith(`${prefix}/`) || lower.startsWith(`${prefix}-`)) {
    return true;
  }
  if (slug.split("/").some((segment) => repoLinkMatches(segment, repoName, fullName))) {
    return true;
  }
  return extractTags(note.title ?? "").some((tag) => repoLinkMatches(tag, repoName, fullName));
}

export function eventOverlapsHubWindow(
  event: Pick<WorkHubEvent, "start" | "end">,
  nowMs = Date.now(),
  days = HUB_CALENDAR_WINDOW_DAYS,
): boolean {
  const start = Date.parse(event.start);
  if (Number.isNaN(start)) return false;
  const parsedEnd = event.end ? Date.parse(event.end) : start;
  const end = Number.isNaN(parsedEnd) ? start : parsedEnd;
  const from = nowMs - days * DAY_MS;
  const to = nowMs + days * DAY_MS;
  return start <= to && end >= from;
}

export function calendarEventBelongsOnHub(
  event: Pick<WorkHubEvent, "tags" | "links">,
  repoName: string,
  fullName: string | null,
  aliases: readonly string[] = [],
): boolean {
  if (hopsIncludeRepo(event.links ?? [], repoName, fullName, aliases)) return true;
  return (event.tags ?? []).some((tag) => repoLinkMatches(tag, repoName, fullName, aliases));
}

export function capHubList<T>(items: readonly T[], limit: number, expanded: boolean): T[] {
  return expanded ? [...items] : items.slice(0, limit);
}

function taskHops(task: WorkHubTask): EntityRef[] {
  const refs = [...(task.links ?? [])];
  if (task.jiraKey) {
    refs.push({ kind: "jira", id: task.jiraKey, label: task.jiraKey });
  }
  return refs;
}

function jiraKeysOnTask(task: WorkHubTask): string[] {
  const keys = new Set<string>();
  if (task.jiraKey?.trim()) keys.add(task.jiraKey.trim().toUpperCase());
  for (const link of task.links ?? []) {
    if (link.kind === "jira" && link.id.trim()) keys.add(link.id.trim().toUpperCase());
  }
  return [...keys];
}

function hopsIncludeRepo(
  refs: readonly EntityRef[],
  repoName: string,
  fullName: string | null,
  aliases: readonly string[],
): boolean {
  return refs.some((ref) => ref.kind === "repo" && repoLinkMatches(ref.id, repoName, fullName, aliases));
}

function tsMs(iso: string | undefined): number {
  if (!iso) return 0;
  const n = Date.parse(iso);
  return Number.isNaN(n) ? 0 : n;
}

function taskRecency(task: WorkHubTask): number {
  return tsMs(task.createdAt) || tsMs(task.date);
}

function ticketRecency(ticket: WorkHubTicket): number {
  return tsMs(ticket.updatedAt);
}

function compareCalendarForHub(a: WorkHubEvent, b: WorkHubEvent, nowMs: number): number {
  const aStart = tsMs(a.start);
  const bStart = tsMs(b.start);
  const aFuture = aStart >= nowMs;
  const bFuture = bStart >= nowMs;
  if (aFuture !== bFuture) return aFuture ? -1 : 1;
  return aFuture ? aStart - bStart : bStart - aStart;
}

function clusterRecency(cluster: WorkCluster): number {
  let max = cluster.jira ? ticketRecency(cluster.jira) : 0;
  for (const task of cluster.tasks) max = Math.max(max, taskRecency(task));
  for (const note of cluster.notes) max = Math.max(max, note.ts ?? 0);
  for (const event of cluster.calendar) max = Math.max(max, tsMs(event.start));
  return max;
}

export function hubCalendarEvents(model: WorkHubModel, nowMs = Date.now()): WorkHubEvent[] {
  const seen = new Set<string>();
  const out: WorkHubEvent[] = [];
  for (const event of [...model.clusters.flatMap((cluster) => cluster.calendar), ...model.leftoverEvents]) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    out.push(event);
  }
  return out.sort((a, b) => compareCalendarForHub(a, b, nowMs));
}

/**
 * One-hop work clusters for a repo hub (this repo only).
 * Seeds: tasks that entity-link or #tag this repo, plus in-progress Jira whose
 * one-hop graph touches the repo (or a repo-linked task). Open tickets that
 * are already clustered still receive jira hops/notes.
 */
export function clusterRepoWork(input: {
  repoName: string;
  fullName: string | null;
  aliases?: readonly string[];
  tasks: WorkHubTask[];
  tickets: WorkHubTicket[];
  notes: WorkHubNote[];
  prs: WorkHubPr[];
  events: WorkHubEvent[];
  jiraHops?: readonly JiraHop[];
  nowMs?: number;
}): WorkHubModel {
  const aliases = input.aliases ?? [];
  const nowMs = input.nowMs ?? Date.now();
  const relatedTasks = input.tasks.filter((task) =>
    taskBelongsToRepo(task, input.repoName, input.fullName, aliases),
  );
  const relatedIds = new Set(relatedTasks.map((task) => task.id));

  const ticketByKey = new Map(input.tickets.map((ticket) => [ticket.key.toUpperCase(), ticket]));
  const noteBySlug = new Map(input.notes.map((note) => [note.slug, note]));
  const prByUrl = new Map(input.prs.map((pr) => [pr.url, pr]));
  const prById = new Map(input.prs.map((pr) => [`${pr.repo}#${pr.number}`.toLowerCase(), pr]));
  const eventById = new Map(input.events.map((event) => [event.id, event]));

  const usedNotes = new Set<string>();
  const usedPrs = new Set<string>();
  const usedEvents = new Set<string>();
  const usedTasks = new Set<string>();
  const clusteredJira = new Set<string>();
  const associatedKeys = new Set<string>();

  function noteFromRef(ref: EntityRef): WorkHubNote | undefined {
    if (ref.kind !== "note") return undefined;
    const known = noteBySlug.get(ref.id);
    if (known) return known;
    const leaf = ref.id.split("/").pop() || ref.id;
    const title = ref.label && ref.label !== "Note" ? ref.label : leaf;
    return {
      slug: ref.id,
      title,
      href: ref.href ?? `/notes/${ref.id}`,
    };
  }

  function attachRef(cluster: WorkCluster, ref: EntityRef) {
    if (ref.kind === "note") {
      const note = noteFromRef(ref);
      if (note && !usedNotes.has(note.slug)) {
        usedNotes.add(note.slug);
        cluster.notes.push(note);
      }
    } else if (ref.kind === "pr") {
      const pr = prByUrl.get(ref.href ?? "") ?? prById.get(ref.id.toLowerCase());
      if (pr && !usedPrs.has(pr.url)) {
        usedPrs.add(pr.url);
        cluster.prs.push(pr);
      }
    } else if (ref.kind === "calendar" || ref.kind === "meeting") {
      const event = eventById.get(ref.id);
      if (!event || usedEvents.has(event.id)) return;
      if (!eventOverlapsHubWindow(event, nowMs)) return;
      usedEvents.add(event.id);
      cluster.calendar.push(event);
    }
  }

  const clusters: WorkCluster[] = [];
  const leftoverNoteHydrates: WorkHubNote[] = [];

  function clusterForJira(key: string): WorkCluster {
    const upper = key.toUpperCase();
    let cluster = clusters.find((item) => item.jira?.key.toUpperCase() === upper);
    if (cluster) return cluster;
    const ticket = ticketByKey.get(upper);
    cluster = {
      id: `jira:${upper}`,
      inProgress: ticket ? isJiraInProgress(ticket.status) : false,
      jira: ticket,
      tasks: [],
      notes: [],
      prs: [],
      calendar: [],
    };
    clusteredJira.add(upper);
    clusters.push(cluster);
    return cluster;
  }

  function attachTaskToCluster(cluster: WorkCluster, task: WorkHubTask) {
    if (!cluster.tasks.some((item) => item.id === task.id)) {
      usedTasks.add(task.id);
      cluster.tasks.push(task);
    }
    for (const ref of taskHops(task)) attachRef(cluster, ref);
  }

  function tasksForJiraKey(key: string): WorkHubTask[] {
    const upper = key.toUpperCase();
    return input.tasks.filter((task) => jiraKeysOnTask(task).includes(upper));
  }

  function hydrateLeftoverNote(ref: EntityRef) {
    const note = noteFromRef(ref);
    if (!note || usedNotes.has(note.slug)) return;
    usedNotes.add(note.slug);
    leftoverNoteHydrates.push(note);
  }

  for (const task of relatedTasks) {
    for (const key of jiraKeysOnTask(task)) associatedKeys.add(key);
    const hops = taskHops(task);
    const inProgressKeys = jiraKeysOnTask(task).filter((key) => {
      const ticket = ticketByKey.get(key);
      return ticket ? isJiraInProgress(ticket.status) : false;
    });

    if (inProgressKeys.length > 0) {
      for (const key of inProgressKeys) {
        attachTaskToCluster(clusterForJira(key), task);
      }
      continue;
    }

    if (jiraKeysOnTask(task).length > 0) {
      // Open/To Do Jira: not Active work. Still hydrate one-hop notes.
      for (const ref of hops) {
        if (ref.kind === "note") hydrateLeftoverNote(ref);
      }
      continue;
    }

    usedTasks.add(task.id);
    const cluster: WorkCluster = {
      id: `task:${task.id}`,
      inProgress: false,
      tasks: [],
      notes: [],
      prs: [],
      calendar: [],
    };
    clusters.push(cluster);
    attachTaskToCluster(cluster, task);
  }

  for (const hop of input.jiraHops ?? []) {
    const ticket = ticketByKey.get(hop.key.toUpperCase());
    if (!ticket) continue;
    const already = clusteredJira.has(hop.key.toUpperCase());
    const touchesRepo =
      hopsIncludeRepo(hop.related, input.repoName, input.fullName, aliases) ||
      hop.related.some((ref) => ref.kind === "task" && relatedIds.has(ref.id));
    if (touchesRepo) associatedKeys.add(hop.key.toUpperCase());

    if (!isJiraInProgress(ticket.status) && !already) {
      if (touchesRepo || associatedKeys.has(hop.key.toUpperCase())) {
        for (const ref of [...hop.related, ...hop.notes]) {
          if (ref.kind === "note") hydrateLeftoverNote(ref);
        }
      }
      continue;
    }
    if (!touchesRepo && already) {
      const cluster = clusterForJira(hop.key);
      for (const ref of [...hop.related, ...hop.notes]) attachRef(cluster, ref);
      continue;
    }
    if (!touchesRepo) continue;
    const cluster = clusterForJira(hop.key);
    for (const ref of hop.related) {
      if (ref.kind === "task") {
        const task = input.tasks.find((item) => item.id === ref.id);
        if (task) attachTaskToCluster(cluster, task);
      }
      attachRef(cluster, ref);
    }
    for (const note of hop.notes) attachRef(cluster, note);
  }

  // Every task on an in-progress ticket, even if that task isn't repo-linked.
  for (const cluster of [...clusters]) {
    if (!cluster.jira || !cluster.inProgress) continue;
    for (const task of tasksForJiraKey(cluster.jira.key)) {
      attachTaskToCluster(cluster, task);
      for (const key of jiraKeysOnTask(task)) {
        associatedKeys.add(key);
        const extra = ticketByKey.get(key);
        if (!extra || isJiraDone(extra.status)) continue;
        if (isJiraInProgress(extra.status) && key !== cluster.jira.key.toUpperCase()) {
          attachTaskToCluster(clusterForJira(key), task);
        }
      }
    }
  }

  for (const cluster of clusters) {
    cluster.tasks.sort((a, b) => taskRecency(b) - taskRecency(a));
    cluster.notes.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
    cluster.calendar.sort((a, b) => compareCalendarForHub(a, b, nowMs));
  }

  clusters.sort(
    (a, b) => Number(b.inProgress) - Number(a.inProgress) || clusterRecency(b) - clusterRecency(a),
  );

  const leftoverEvents = input.events
    .filter(
      (event) =>
        !usedEvents.has(event.id) &&
        eventOverlapsHubWindow(event, nowMs) &&
        calendarEventBelongsOnHub(event, input.repoName, input.fullName, aliases),
    )
    .sort((a, b) => compareCalendarForHub(a, b, nowMs));

  const leftoverNotes = [
    ...leftoverNoteHydrates,
    ...input.notes.filter((note) => !usedNotes.has(note.slug)),
  ].sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));

  const leftoverTasks = relatedTasks
    .filter((task) => !usedTasks.has(task.id))
    .sort((a, b) => taskRecency(b) - taskRecency(a));

  // A backlog task row already shows its ticket key, summary and status. Listing
  // the same ticket again under "Other tickets" doubled every backlog item.
  const taskBackedKeys = new Set(leftoverTasks.flatMap(jiraKeysOnTask));

  const openTickets = input.tickets
    .filter((ticket) => {
      if (isJiraDone(ticket.status) || isJiraInProgress(ticket.status)) return false;
      const key = ticket.key.toUpperCase();
      if (clusteredJira.has(key) || taskBackedKeys.has(key)) return false;
      return associatedKeys.has(key);
    })
    .sort((a, b) => ticketRecency(b) - ticketRecency(a) || b.key.localeCompare(a.key));

  return {
    clusters,
    leftoverTasks,
    leftoverNotes,
    leftoverPrs: input.prs.filter((pr) => !usedPrs.has(pr.url)),
    leftoverEvents,
    openTickets,
  };
}
