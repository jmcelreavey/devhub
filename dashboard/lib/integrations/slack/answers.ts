import path from "node:path";
import { listTaskProfiles, resolveActiveProfileId } from "@shared/vault/task-profiles.ts";
import { tasksOnDay } from "@shared/tasks/store.ts";
import { TASK_NOTE_STATUS_LABEL } from "@shared/task-note/meta.ts";
import { getActiveTasksDir, getTasksDir } from "@/lib/content/dirs";
import { withTaskDirectory } from "@/lib/tasks/profile-context";
import { todayISO } from "@/lib/utils";
import { readNotesBoard } from "@/lib/storyboard/notes-board";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
import { homeWorkSummary } from "@/lib/storyboard/home-summary";
import { resolveWorkPresentation } from "@/lib/storyboard/work-summary";
import { listWorkflows } from "@/lib/workflows/store";
import type { WorkflowInboxItem } from "@/lib/workflows/inbox";
import { routeSlackMessage, type RouteResult, type SlackListStatus, type SlackRouteContext } from "./router";
import { slackStatusLabel, type SlackCardItem } from "./format";
import type { SlackTaskRef } from "./client";

export interface SlackAnswer {
  kind: "help" | "unknown" | "tasks" | "unavailable";
  profile: string;
  title: string;
  lines: string[];
  more: number;
  href: string;
  items?: SlackCardItem[];
  total?: number;
  taskRef?: SlackTaskRef;
  /** The deterministic rules had no answer: the tool router may take it from here. */
  fallthrough?: boolean;
}

export interface SlackSnapshot {
  cards: readonly BoardCard[];
  items: readonly WorkflowInboxItem[];
  todayTaskIds: readonly string[];
  errors: readonly string[];
}

export function slackRouteContext(): SlackRouteContext {
  const root = getTasksDir();
  return { activeProfile: resolveActiveProfileId(root) ?? "legacy", profiles: listTaskProfiles(root) };
}

export function loadSlackSnapshot(profile: string): SlackSnapshot {
  return withSlackProfile(profile, () => {
    const board = readNotesBoard({ doneWindowDays: null });
    const byId = new Map(board.cards.map((card) => [card.taskId, card]));
    const items = listWorkflows().flatMap((workflow) => {
      const card = byId.get(workflow.taskId);
      return card?.task ? [{ task: card.task, workflow }] : [];
    });
    const today = todayISO();
    return { cards: board.cards, items, todayTaskIds: tasksOnDay(getActiveTasksDir(), today, today).map((task) => task.id), errors: board.errors };
  });
}

export function withSlackProfile<Result>(profile: string, work: () => Result): Result {
  const root = getTasksDir();
  const context = slackRouteContext();
  if (![context.activeProfile, ...context.profiles].includes(profile)) throw new Error("Unknown task profile");
  return withTaskDirectory(root, context.profiles.length ? path.join(root, profile) : root, work);
}

function scopedHref(href: string, profile: string): string {
  const url = new URL(href, "http://localhost");
  url.searchParams.set("profile", profile);
  return url.pathname + url.search;
}

const STATUS_TITLES: Record<SlackListStatus, string> = { todo: "To do", running: "Running", "in-review": "In review", blocked: "Blocked", done: "Done" };

export function buildSlackAnswer(route: RouteResult, snapshot?: SlackSnapshot, now = Date.now()): SlackAnswer {
  if (route.kind === "tools") return buildSlackAnswer({ kind: "unknown", profile: route.profile });
  const base = { profile: route.profile, more: 0, href: scopedHref("/storyboard", route.profile) };
  if (route.kind === "unknown-profile") return { ...base, kind: "unknown", title: "Profile not found", lines: [`There isn't a task profile called ${route.requested}. Try “help” or use a profile shown in DevHub.`] };
  if (route.kind === "help" || route.kind === "unknown") return {
    ...base, kind: route.kind, ...(route.kind === "unknown" ? { fallthrough: true } : {}), title: route.kind === "help" ? "DevHub · Slack help" : "I didn't recognise that. Try “help”.",
    lines: [
      "Ask about PRs, tasks, Jira, your calendar, notes or agent runs.",
      "Try “what PRs do I have?”, “needs me”, “to do”, “running”, “in review”, “blocked”, “done”, “today”, “auto status” or a Jira key.",
      "Add “in personal” or “in work” to scope a query. Task threads keep their original profile.",
      "Reads run straight away. Changes ask you to Confirm. Reply in a task thread to answer its oldest open question.",
      "Try “done PTF-1”, “add task …”, “plan PTF-1”, “prs”, “meetings today”, “next meeting”, “my tickets” or “worktrees”.",
      "Say “cost” for today's usage, or “refresh tools” to reload the tool list.",
    ],
  };
  if (!snapshot || snapshot.errors.length) return { ...base, kind: "unavailable", title: "Task data is unavailable", lines: ["Some task sources could not be read. Open DevHub to check them before relying on a list."] };

  const cards = [...new Map(snapshot.cards.map((card) => [card.taskId, card])).values()];
  const workflows = new Map(snapshot.items.map((item) => [item.task.id, item.workflow]));
  const home = homeWorkSummary(cards, snapshot.items, [], now);
  const todayIds = new Set(snapshot.todayTaskIds);
  let selected: readonly BoardCard[];
  let title: string;
  let href = base.href;
  switch (route.kind) {
    case "task":
      selected = cards.filter((card) => card.jira?.some((key) => key.toUpperCase() === route.jiraKey));
      title = route.jiraKey;
      href = scopedHref(`/storyboard?jira=${encodeURIComponent(route.jiraKey)}&done=all`, route.profile);
      break;
    case "needs-you":
      selected = home["needs-you"].flatMap((work) => work.kind === "task" ? [work.card] : []);
      title = "Needs you";
      href = scopedHref("/storyboard?attention=needs-you", route.profile);
      break;
    case "today":
      selected = cards.filter((card) => todayIds.has(card.taskId));
      title = "Today's tasks";
      break;
    case "auto-status":
      selected = cards.filter((card) => card.auto && !card.taskDone && !card.task?.abandonedAt);
      title = "Auto status";
      break;
    case "status":
      selected = route.status === "running" ? home.running.map((work) => work.card)
        : cards.filter((card) => route.status === "in-review" ? ["draft-pr", "ready-for-review"].includes(card.status)
          : card.status === route.status);
      title = STATUS_TITLES[route.status];
      if (route.status === "running") href = scopedHref("/storyboard?queue=running", route.profile);
      else if (route.status === "done") href = scopedHref("/storyboard?view=board&done=all", route.profile);
      break;
  }
  const lines = selected.slice(0, 8).map((card) => {
    const presentation = resolveWorkPresentation(card, workflows.get(card.taskId), now);
    const label = TASK_NOTE_STATUS_LABEL[card.status];
    return `${card.title.slice(0, 150)}\n${label} · ${presentation.status.slice(0, 120)} · Next: ${presentation.action?.label ?? (card.taskDone || card.task?.abandonedAt ? "No action needed" : "Open in DevHub")}`;
  });
  const items = selected.slice(0, 8).map((card): SlackCardItem => {
    const presentation = resolveWorkPresentation(card, workflows.get(card.taskId), now);
    return { title: card.title, href: scopedHref(`/storyboard?task=${encodeURIComponent(card.taskId)}`, route.profile), status: slackStatusLabel(TASK_NOTE_STATUS_LABEL[card.status]), meta: presentation.status.slice(0, 180) };
  });
  if (selected.length === 1) href = scopedHref(`/storyboard?task=${encodeURIComponent(selected[0].taskId)}`, route.profile);
  return {
    ...base, kind: "tasks", title, lines: lines.length ? lines : [route.kind === "task" ? `No task linked to ${route.jiraKey} in this profile.` : "Nothing here in this profile."], more: Math.max(0, selected.length - 8), href, items, total: selected.length,
    ...(selected.length === 1 ? { taskRef: { profile: route.profile, taskId: selected[0].taskId, date: selected[0].date, title: selected[0].title } } : {}),
  };
}

export function answerSlackMessage(message: string, context = slackRouteContext()): SlackAnswer {
  const route = routeSlackMessage(message, context);
  const snapshot = ["help", "tools", "unknown", "unknown-profile"].includes(route.kind) ? undefined : loadSlackSnapshot(route.profile);
  return buildSlackAnswer(route, snapshot);
}
