import { z } from "zod";
import { defineAction } from "./define.ts";
import type { Task } from "../tasks/types.ts";
import { blocksToText, textToBlocks } from "../markdown-convert/index.ts";
import { parseEntityLinksFromMarkdown } from "../entity-note/index.ts";
import { addTaskNoteRefs } from "../task-note/sections.ts";
import { buildTaskNoteMarkdown, normalizeTaskLinkState, taskEntityRefs, taskNotePath } from "../task-note/index.ts";

const taskLinkInput = z.object({
  kind: z.enum(["task", "meeting", "pr", "note", "diagram", "calendar", "jira", "repo"]),
  id: z.string(),
  label: z.string(),
  href: z.string().optional(),
  marker: z.string().optional(),
});

export const taskListInput = z.object({
  date: z.string().optional().describe("Date in YYYY-MM-DD format. Defaults to today."),
}).meta({ additionalProperties: false });

export interface TaskListContext {
  storage: () => { onDay: (day: string, today?: string) => Promise<Task[]> };
  prepare: () => Promise<void>;
  today: () => string;
  present: (task: Task, date: string) => Task;
}

export interface TaskListResult {
  date: string;
  tasks: Task[];
  total: number;
  completed: number;
  abandoned: number;
  moved: number;
}

function summarizeTaskDay(date: string, tasks: Task[]): TaskListResult {
  return {
    date,
    tasks,
    total: tasks.length,
    completed: tasks.filter((task) => task.done).length,
    abandoned: tasks.filter((task) => !!task.abandonedAt).length,
    moved: tasks.filter((task) => task.endReason === "legacy-moved" && task.endDate === date).length,
  };
}

export const taskList = defineAction<typeof taskListInput, TaskListContext, TaskListResult>({
  input: taskListInput,
  http: { method: "GET", path: "/api/tasks" },
  mcp: { name: "tasks_list", toolset: "tasks", description: "List today's tasks. Returns all tasks for today with their status (done/abandoned/active)." },
  handler: async ({ date }, context) => {
    await context.prepare();
    const today = context.today();
    const target = date || today;
    const tasks = (await context.storage().onDay(target, today)).map((task) => context.present(task, target));
    return summarizeTaskDay(target, tasks);
  },
});

export const taskHistoryInput = z.object({
  includeTasks: z.boolean().optional().describe("Include full task details (default: summaries only)"),
  date: z.string().optional().describe("Filter to a specific date (YYYY-MM-DD)"),
  query: z.string().trim().min(1).max(200).optional().describe("Case-insensitive match on task text, id or Jira key, across all days (or `date`)"),
  days: z.number().int().min(1).max(3650).optional().describe("With includeTasks and no date/query: only the most recent N days (default: all)"),
}).meta({ additionalProperties: false });

export interface TaskHistoryContext extends TaskListContext {
  storage: () => {
    onDay: (day: string, today?: string) => Promise<Task[]>;
    listDays: (today?: string) => Promise<Array<{ date: string; tasks: Task[] }>>;
  };
  modified: () => number;
}

export interface TaskHistoryResult {
  date?: string;
  query?: string;
  includeTasks?: boolean;
  days: Array<TaskListResult & { modified: number }>;
  matches: Array<{ date: string; task: Task }>;
  older: number;
}

export const taskHistory = defineAction<typeof taskHistoryInput, TaskHistoryContext, TaskHistoryResult>({
  input: taskHistoryInput,
  http: { method: "GET", path: "/api/tasks/history" },
  mcp: { name: "tasks_history", toolset: "tasks", description: "List task history across all days. Returns summaries (date, total, completed, abandoned) or full task lists. To find a task by Jira key, id or wording, pass `query` — it searches every day and returns only the matches with their date." },
  handler: async ({ date, query, includeTasks, days: limit }, context) => {
    await context.prepare();
    const today = context.today();
    const buckets = date
      ? [{ date, tasks: await context.storage().onDay(date, today) }]
      : await context.storage().listDays(today);
    const modified = context.modified();
    const history = buckets.map((bucket) => ({ ...summarizeTaskDay(bucket.date, bucket.tasks.map((task) => context.present(task, bucket.date))), modified }));
    const matches: TaskHistoryResult["matches"] = [];
    if (query) {
      const needle = query.toLowerCase();
      const seen = new Set<string>();
      for (const day of history) for (const task of day.tasks) {
        const haystack = `${task.text}\n${task.id}\n${(task.legacyIds ?? []).join("\n")}\n${task.jiraKey ?? ""}`.toLowerCase();
        if (!haystack.includes(needle) || seen.has(task.id)) continue;
        seen.add(task.id);
        matches.push({ date: day.date, task });
      }
    }
    const older = !date && !query && includeTasks && limit ? Math.max(0, history.length - limit) : 0;
    return { date, query, includeTasks, days: older ? history.slice(0, limit) : history, matches, older };
  },
});

export const taskCreateInput = z.object({
  text: z.string().describe("Task description (1-500 chars). Jira keys like XYZ-1234 are auto-detected."),
  date: z.string().optional().describe("Date in YYYY-MM-DD format. Defaults to today."),
  due: z.string().optional().describe("Due date in YYYY-MM-DD format."),
  withNote: z.boolean().optional().describe("If true, also create the linked task-notes/ note"),
  parentKey: z.string().regex(/^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/).optional().describe("Parent Jira key for context only; never inferred as the task's own ticket."),
  draft: z.boolean().optional().describe("Create as a draft (an idea, not yet a plan). Prefer tasks_capture, which also saves related context."),
  stage: z.enum(["draft"]).optional(),
  links: z.array(taskLinkInput).optional().describe("EntityRefs to store on the task for hop-around"),
}).meta({ additionalProperties: false });

export interface TaskCreateContext {
  prepare: () => Promise<void>;
  today: () => string;
  create: (input: TaskCreateStorageInput) => Promise<Task>;
  createNote?: (task: Task, date: string) => string | Promise<string>;
}

export interface TaskCreateStorageInput {
  text: string;
  startDate: string;
  due?: string;
  links?: Task["links"];
  stage?: Task["stage"];
  parentKey?: string;
}

export interface TaskCreateResult {
  task: Task;
  notePath?: string;
}

export const taskCreate = defineAction<typeof taskCreateInput, TaskCreateContext, TaskCreateResult>({
  input: taskCreateInput,
  http: { method: "POST", path: "/api/tasks" },
  mcp: { name: "tasks_create", toolset: "tasks", description: "Create a new task. Auto-extracts Jira keys from text (e.g. XYZ-1234). Optionally create a linked task note (EntityRef ## Links) and/or attach hop-around links (PR/calendar/note/repo)." },
  handler: async ({ text, date, due, withNote, links, draft, stage, parentKey }, context) => {
    await context.prepare();
    const startDate = date || context.today();
    const task = await context.create({ text, startDate, due, links, stage: stage ?? (draft ? "draft" : undefined), parentKey });
    if (!withNote) return { task };
    if (!context.createNote) throw new Error("Task note creation is unavailable.");
    return { task, notePath: await context.createNote(task, startDate) };
  },
});

export const taskUpdateInput = z.object({
  id: z.string().describe("Task ID (UUID)"),
  text: z.string().optional().describe("New task text"),
  done: z.boolean().optional().describe("Set done status directly"),
  due: z.string().nullable().optional().describe("Due date (YYYY-MM-DD) or null to clear"),
  status: z.enum(["complete", "abandon", "reactivate"]).optional().describe("Status change: complete, abandon, or reactivate"),
  abandonReason: z.string().optional().describe("Reason for abandoning"),
  stage: z.enum(["draft", "ready"]).optional().describe("draft = idea not yet planned; ready = an agent can run it"),
  date: z.string().optional().describe("Date the task belongs to (YYYY-MM-DD). Defaults to today."),
  links: z.array(taskLinkInput).optional().describe("Replace hop-around EntityRefs on the task"),
}).meta({ additionalProperties: false });

export type TaskUpdateInput = z.output<typeof taskUpdateInput>;

export interface TaskUpdatePatch {
  text?: string;
  done?: boolean;
  due?: string | null;
  status?: "complete" | "abandon" | "reactivate";
  abandonReason?: string;
  stage?: "draft" | "ready";
  links?: Task["links"];
  jiraKey?: string | null;
}

interface TaskUpdateSession {
  onDay: (day: string, today?: string) => Promise<Task[]>;
  find: (id: string) => Promise<Task | null>;
  patch: (id: string, patch: TaskUpdatePatch) => Promise<Task | null>;
}

export interface TaskUpdateContext {
  storage: () => { withWriteLock: <T>(operation: (storage: TaskUpdateSession) => Promise<T>) => Promise<T> };
  prepare: () => Promise<void>;
  today: () => string;
  scope: "day" | "all";
  patch: (task: Task, input: TaskUpdateInput) => TaskUpdatePatch;
  present: (task: Task, date: string) => Task;
}

export interface TaskUpdateResult {
  id: string;
  task: Task | null;
  completionRequested: boolean;
}

export const taskUpdate = defineAction<typeof taskUpdateInput, TaskUpdateContext, TaskUpdateResult>({
  input: taskUpdateInput,
  http: { method: "PATCH", path: "/api/tasks", discriminator: "query today is not 1, body has no ids, completion or timer" },
  mcp: { name: "tasks_update", toolset: "tasks", description: "Update a task: toggle done, edit text, set due date, abandon, reactivate, or set its stage. stage here is unchecked — to mark a plan ready use tasks_set_stage, which runs the readiness checklist." },
  handler: async (input, context) => {
    await context.prepare();
    const today = context.today();
    const date = input.date || today;
    return context.storage().withWriteLock(async (storage) => {
      const current = context.scope === "day"
        ? (await storage.onDay(date, today)).find((task) => task.id === input.id || task.legacyIds?.includes(input.id))
        : await storage.find(input.id);
      if (!current) return { id: input.id, task: null, completionRequested: false };
      const patch = context.patch(current, input);
      const task = await storage.patch(current.id, patch);
      return { id: input.id, task: task ? context.present(task, date) : null, completionRequested: patch.status === "complete" };
    });
  },
});

export const taskReopenInput = z.object({
  id: z.string().trim().regex(/^[A-Za-z0-9_-]{1,128}$/).describe("Task ID or linked Jira ticket key"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reason: z.string().trim().max(400).optional(),
  addressFeedback: z.boolean().optional().describe("Start an agent to address only new feedback. Confirm before setting true."),
}).meta({ additionalProperties: false });

export interface TaskReopenValue {
  task?: { id: string; text: string };
  alreadyOpen?: boolean;
  column?: string;
}

export type TaskReopenOutcome =
  | { ok: true; id: string; value: TaskReopenValue }
  | { ok: false; id: string; error: string; status: number; body?: unknown };

export interface TaskReopenContext {
  reopen: (input: z.output<typeof taskReopenInput>) => Promise<Omit<Extract<TaskReopenOutcome, { ok: true }>, "id"> | Omit<Extract<TaskReopenOutcome, { ok: false }>, "id">>;
}

export const taskReopen = defineAction<typeof taskReopenInput, TaskReopenContext, TaskReopenOutcome>({
  input: taskReopenInput,
  http: { method: "POST", path: "/api/tasks/reopen" },
  mcp: { name: "task_reopen", toolset: "tasks", description: "Reopen a finished or abandoned task into Review or In progress, keeping its note and history. Already-open tasks are unchanged. Optionally address new cached PR feedback with an agent, which commits and pushes to the existing PR branch (hooks on, never forced; a failed push stops and shows in Needs action). Merged PRs need a follow-up task instead. Requires the dashboard." },
  handler: async (input, context) => ({ ...await context.reopen(input), id: input.id }),
});

const singleLine = (max: number) =>
  z.string().trim().min(1).max(max).refine((value) => ![...value].some((char) => char <= "\u001f" || char === "\u007f"), "must be one line");

export const taskContextSyncInput = z.object({
  id: z.string().trim().min(1).max(200).describe("Task ID (UUID)"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Date the task belongs to (YYYY-MM-DD). Defaults to today."),
  links: z.array(taskLinkInput.extend({
    id: singleLine(500),
    label: singleLine(500).refine((value) => !value.includes("[") && !value.includes("]"), "must not contain markdown brackets"),
    href: singleLine(2_000).refine((value) => !/[)]/.test(value), "must not contain ')' ").optional(),
  }).omit({ marker: true })).max(50).optional().describe("EntityRefs to merge into the task by kind+id (existing label/href refreshed when provided)"),
  noteSummary: z.string().trim().min(1).max(10_000).optional().describe("Short markdown summary to append to the task note under a keyed '## Implementation <key>' heading"),
  noteSummaryKey: z.string().trim().min(1).max(500).optional().describe("Required with noteSummary. Exact idempotency key, e.g. the PR URL or commit SHA."),
}).meta({ additionalProperties: false });

interface TaskContextSyncSession {
  onDay: (day: string, today?: string) => Promise<Task[]>;
  patch: (id: string, patch: TaskUpdatePatch) => Promise<Task | null>;
}

export interface TaskContextSyncContext {
  storage: () => { withWriteLock: <T>(operation: (storage: TaskContextSyncSession) => Promise<T>) => Promise<T> };
  notes: { read: (path: string) => { content: unknown } | null; write: (path: string, content: unknown) => unknown };
  prepare: () => Promise<void>;
  today: () => string;
  present: (task: Task, date: string) => Task;
}

export interface TaskContextSyncResult {
  text: string;
  isError?: boolean;
}

function sameTaskRef(left: { kind: string; id: string; href?: string }, right: { kind: string; id: string; href?: string }): boolean {
  return left.kind === right.kind && (left.id === right.id || (!!left.href && left.href === right.href));
}

export const taskContextSync = defineAction<typeof taskContextSyncInput, TaskContextSyncContext, TaskContextSyncResult>({
  input: taskContextSyncInput,
  http: { reason: "Context sync is a headless MCP operation; the dashboard has no equivalent endpoint." },
  mcp: { name: "tasks_context_sync", toolset: "tasks", description: "Merge context into a task and its linked note in one server-side operation: merges hop-around links by kind+id (never drops existing links), appends missing note link blocks without rewriting rich content, and appends an idempotent keyed implementation summary." },
  handler: async ({ id, date, links, noteSummary, noteSummaryKey }, context) => {
    await context.prepare();
    const today = context.today();
    const target = date || today;
    return context.storage().withWriteLock(async (storage) => {
      const found = (await storage.onDay(target, today)).find((task) => task.id === id || task.legacyIds?.includes(id));
      if (!found) return { text: `Task not found: ${id}` };
      if (noteSummary && !noteSummaryKey) return { isError: true, text: "noteSummaryKey is required when noteSummary is provided." };
      let task = context.present(found, target);
      const merged = [...(task.links ?? [])];
      let linksAdded = 0;
      let linksUpdated = 0;
      for (const ref of links ?? []) {
        const index = merged.findIndex((existing) => existing.kind === ref.kind && existing.id === ref.id);
        if (index === -1) {
          merged.push(ref);
          linksAdded++;
        } else if ((ref.label && ref.label !== merged[index].label) || (ref.href && ref.href !== merged[index].href)) {
          merged[index] = { ...merged[index], label: ref.label || merged[index].label, href: ref.href || merged[index].href };
          linksUpdated++;
        }
      }
      const linksChanged = linksAdded > 0 || linksUpdated > 0;
      if (linksChanged) {
        const normalized = normalizeTaskLinkState(task.text, task.jiraKey, merged, task.parentKey);
        const updated = await storage.patch(task.id, {
          text: normalized.text,
          links: normalized.links?.length ? normalized.links : [],
          ...(normalized.jiraKey ? { jiraKey: normalized.jiraKey } : {}),
        });
        if (updated) task = context.present(updated, target);
      }
      const source = { notePath: task.notePath, id: task.id, text: task.text, date: target, jiraKey: task.jiraKey, related: task.links ?? merged };
      const notePath = taskNotePath(source);
      const existing = context.notes.read(notePath);
      const markdown = existing?.content != null ? blocksToText(existing.content as unknown[]) : null;
      const noteCreated = !existing && !!noteSummary;
      let summaryAdded = false;
      let noteChanged = false;
      if (noteCreated) {
        const parts = [buildTaskNoteMarkdown(source)];
        if (noteSummary && noteSummaryKey) {
          parts.push(`## Implementation ${noteSummaryKey}\n\n${noteSummary}`);
          summaryAdded = true;
        }
        context.notes.write(notePath, textToBlocks(parts.join("\n\n")));
        noteChanged = true;
      } else if (existing && markdown !== null) {
        const refs = parseEntityLinksFromMarkdown(markdown);
        const missing = taskEntityRefs(source).filter((ref) => !refs.some((existingRef) => sameTaskRef(existingRef, ref)));
        let blocks = (Array.isArray(existing.content) ? existing.content : [existing.content]) as unknown[];
        let headerChanged = false;
        if (missing.length) {
          const added = addTaskNoteRefs(blocks, missing);
          blocks = added.blocks;
          headerChanged = added.changed;
        }
        const append: string[] = [];
        if (noteSummary && noteSummaryKey) {
          const heading = `## Implementation ${noteSummaryKey}`;
          if (!markdown.split("\n").some((line) => line.trim() === heading)) {
            append.push(`${heading}\n\n${noteSummary}`);
            summaryAdded = true;
          }
        }
        if (append.length || headerChanged) {
          context.notes.write(notePath, [...blocks, ...(append.length ? textToBlocks(append.join("\n\n")) : [])]);
          noteChanged = true;
        }
      }
      const changes = [
        linksChanged ? `links: +${linksAdded} added, ${linksUpdated} updated` : null,
        existing || noteCreated
          ? `note ${notePath}${noteCreated ? " created" : noteChanged ? " updated" : " unchanged"}${noteSummary ? (summaryAdded ? " (summary added)" : " (summary already present)") : ""}`
          : null,
      ].filter(Boolean);
      return { text: `Synced task ${id} (${target}):\n${changes.length ? changes.map((change) => `- ${change}`).join("\n") : "- no changes"}` };
    });
  },
});

export const taskDeleteInput = z.object({
  id: z.string().describe("Task ID (UUID)"),
  date: z.string().optional().describe("Date the task belongs to (YYYY-MM-DD). Defaults to today."),
}).meta({ additionalProperties: false });

export interface TaskDeleteContext {
  storage: () => {
    withWriteLock: <T>(operation: (storage: TaskDeleteSession) => Promise<T>) => Promise<T>;
  };
  prepare: () => Promise<void>;
  today: () => string;
  scope: "day" | "all";
}

interface TaskDeleteSession {
  onDay: (day: string) => Promise<Array<{ id: string; legacyIds?: string[] }>>;
  find: (id: string) => Promise<{ id: string } | null>;
  delete: (id: string) => Promise<boolean>;
}

export interface TaskDeleteResult {
  id: string;
  deleted: boolean;
}

export const taskDelete = defineAction<typeof taskDeleteInput, TaskDeleteContext, TaskDeleteResult>({
  input: taskDeleteInput,
  http: { method: "DELETE", path: "/api/tasks" },
  mcp: { name: "tasks_delete", toolset: "tasks", description: "Delete a task permanently." },
  handler: async ({ id, date }, context) => {
    await context.prepare();
    const deleted = await context.storage().withWriteLock(async (storage) => {
      const task = context.scope === "day"
        ? (await storage.onDay(date || context.today())).find((item) => item.id === id || item.legacyIds?.includes(id))
        : await storage.find(id);
      return task ? storage.delete(task.id) : false;
    });
    return { id, deleted };
  },
});

const dashboardTaskInput = z.object({
  id: z.string().min(1, "id is required"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const taskCompletionInput = dashboardTaskInput.extend({ completion: z.boolean() });
export const taskTimerStartInput = dashboardTaskInput.extend({ timer: z.literal("start") });
export const taskTimerStopInput = dashboardTaskInput.extend({ timer: z.literal("stop") });
export const taskReorderInput = z.object({
  ids: z.array(z.string().min(1)).min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export interface TaskCompletionContext {
  set: (id: string, completion: boolean, date?: string) => Promise<Task | null>;
}

export interface TaskTimerContext {
  start: (id: string, date?: string) => Promise<Task | null>;
  stop: (id: string, date?: string) => Promise<Task | null>;
}

export interface TaskReorderContext {
  reorder: (ids: string[], date?: string) => Promise<Task[]>;
}

export type TaskReorderResult = { ok: true; tasks: Task[] } | { ok: false; error: string };

export const taskCompletion = defineAction<typeof taskCompletionInput, TaskCompletionContext, Task | null>({
  input: taskCompletionInput,
  http: { method: "PATCH", path: "/api/tasks", discriminator: "query today is not 1, body has no ids and completion is present" },
  mcp: { reason: "MCP uses tasks_update; the dashboard's guarded completion control stays separate." },
  handler: ({ id, completion, date }, context) => context.set(id, completion, date),
});

export const taskTimerStart = defineAction<typeof taskTimerStartInput, TaskTimerContext, Task | null>({
  input: taskTimerStartInput,
  http: { method: "PATCH", path: "/api/tasks", discriminator: "query today is not 1, body has no ids or completion and timer=start" },
  mcp: { reason: "Task timers are a dashboard-only interaction." },
  handler: ({ id, date }, context) => context.start(id, date),
});

export const taskTimerStop = defineAction<typeof taskTimerStopInput, TaskTimerContext, Task | null>({
  input: taskTimerStopInput,
  http: { method: "PATCH", path: "/api/tasks", discriminator: "query today is not 1, body has no ids or completion and timer=stop" },
  mcp: { reason: "Task timers are a dashboard-only interaction." },
  handler: ({ id, date }, context) => context.stop(id, date),
});

export const taskReorder = defineAction<typeof taskReorderInput, TaskReorderContext, TaskReorderResult>({
  input: taskReorderInput,
  http: { method: "PATCH", path: "/api/tasks", discriminator: "query today is not 1 and body has ids" },
  mcp: { reason: "Task ordering is a dashboard-only interaction." },
  handler: async ({ ids, date }, context) => {
    try {
      return { ok: true, tasks: await context.reorder(ids, date) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Could not reorder tasks." };
    }
  },
});

interface TaskDashboardContext<Input> {
  execute: (input: Input) => Promise<Response>;
}

const storyboardTaskId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/, "Invalid task ID");

export const taskAgentRunSummaryInput = z.object({});
export const taskAgentRunSummary = defineAction<typeof taskAgentRunSummaryInput, TaskDashboardContext<z.output<typeof taskAgentRunSummaryInput>>, Response>({
  input: taskAgentRunSummaryInput,
  http: { method: "GET", path: "/api/tasks/agent-runs/summary" },
  mcp: { reason: "This dashboard poll aggregates all task rows; tasks_agent_runs handles one task at a time." },
  handler: (input, context) => context.execute(input),
});

export const taskNoteTagsInput = z.object({});
export const taskNoteTags = defineAction<typeof taskNoteTagsInput, TaskDashboardContext<z.output<typeof taskNoteTagsInput>>, Response>({
  input: taskNoteTagsInput,
  http: { method: "GET", path: "/api/tasks/note-tags" },
  mcp: { reason: "Task note tags are a dashboard filter index, not a standalone MCP operation." },
  handler: (input, context) => context.execute(input),
});

export const taskFailureOutputInput = z.object({ taskId: z.string().nullable() });
export const taskFailureOutput = defineAction<typeof taskFailureOutputInput, TaskDashboardContext<z.output<typeof taskFailureOutputInput>>, Response>({
  input: taskFailureOutputInput,
  http: { method: "GET", path: "/api/tasks/failure/output" },
  mcp: { reason: "Failure output is a profile-scoped dashboard display for the current board." },
  handler: (input, context) => context.execute(input),
});

export const taskFailureRecoveryInput = z.object({
  taskId: storyboardTaskId,
  key: z.string().min(1).max(8000),
  action: z.enum(["clear", "restore", "retry", "resume"]),
  guidance: z.string().trim().min(1).max(4000).optional(),
});
export const taskFailureRecovery = defineAction<typeof taskFailureRecoveryInput, TaskDashboardContext<z.output<typeof taskFailureRecoveryInput>>, Response>({
  input: taskFailureRecoveryInput,
  http: { method: "POST", path: "/api/tasks/failure" },
  mcp: { reason: "Failure recovery is an explicit dashboard workflow that can resume agent execution." },
  handler: (input, context) => context.execute(input),
});

export const taskCreatePrInput = z.object({ taskId: storyboardTaskId, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
export const taskCreatePr = defineAction<typeof taskCreatePrInput, TaskDashboardContext<z.output<typeof taskCreatePrInput>>, Response>({
  input: taskCreatePrInput,
  http: { method: "POST", path: "/api/tasks/create-pr" },
  mcp: { reason: "Opening a draft PR is an explicitly approved dashboard workflow with its own queue." },
  handler: (input, context) => context.execute(input),
});

export const taskReadyPrsInput = z.object({
  taskId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,128}$/),
  reason: z.string().trim().min(1).max(200).optional(),
});
export const taskReadyPrs = defineAction<typeof taskReadyPrsInput, TaskDashboardContext<z.output<typeof taskReadyPrsInput>>, Response>({
  input: taskReadyPrsInput,
  http: { method: "POST", path: "/api/tasks/ready-prs" },
  mcp: { reason: "The MCP task completion tool invokes this safety step internally; it is not a standalone tool." },
  handler: (input, context) => context.execute(input),
});

export const taskJiraIntakeListInput = z.object({});
export const taskJiraIntakeList = defineAction<typeof taskJiraIntakeListInput, TaskDashboardContext<z.output<typeof taskJiraIntakeListInput>>, Response>({
  input: taskJiraIntakeListInput,
  http: { method: "GET", path: "/api/tasks/jira-intake" },
  mcp: { reason: "The Jira intake picker reads links for the active dashboard profile." },
  handler: (input, context) => context.execute(input),
});

export const taskJiraIntakeCaptureInput = z.object({
  key: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]*-\d+$/),
  summary: z.string().trim().min(1).max(1000),
  url: z.string().url().refine((value) => ["https:", "http:"].includes(new URL(value).protocol), "Use a Jira browse URL"),
  profile: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/).optional(),
});
export const taskJiraIntakeCapture = defineAction<typeof taskJiraIntakeCaptureInput, TaskDashboardContext<z.output<typeof taskJiraIntakeCaptureInput>>, Response>({
  input: taskJiraIntakeCaptureInput,
  http: { method: "POST", path: "/api/tasks/jira-intake" },
  mcp: { reason: "Jira intake is a profile-checked dashboard capture workflow; MCP task creation is separate." },
  handler: (input, context) => context.execute(input),
});

export const taskProfilesReadInput = z.object({ identity: z.boolean(), picker: z.boolean() });
export const taskProfilesRead = defineAction<typeof taskProfilesReadInput, TaskDashboardContext<z.output<typeof taskProfilesReadInput>>, Response>({
  input: taskProfilesReadInput,
  http: { method: "GET", path: "/api/tasks/profiles" },
  mcp: { reason: "Profile identity and picker views belong to the dashboard's machine-local profile workflow." },
  handler: (input, context) => context.execute(input),
});

// Match the file-store profile rules without importing its Node-only filesystem module.
const taskProfileId = z.string().refine(
  (id) => /^[a-z0-9][a-z0-9_-]{0,31}$/.test(id) && !/^\d{4}-\d{2}-\d{2}$/.test(id) && !["items", "legacy", "deleted"].includes(id),
  "Use lowercase letters, digits, - or _ (max 32)",
);
export const taskProfilesWriteInput = z.object({
  body: z.object({
    action: z.enum(["create", "switch", "adopt", "delete"]),
    id: taskProfileId.optional(),
    moveTo: taskProfileId.optional(),
  }),
  picker: z.boolean(),
});
export const taskProfilesWrite = defineAction<typeof taskProfilesWriteInput, TaskDashboardContext<z.output<typeof taskProfilesWriteInput>>, Response>({
  input: taskProfilesWriteInput,
  http: { method: "POST", path: "/api/tasks/profiles" },
  mcp: { reason: "Changing machine-local profiles and moving task files requires the dashboard profile controls." },
  handler: (input, context) => context.execute(input),
});

export const taskSourceContextReadInput = z.object({ taskId: z.string().regex(/^[\w-]{1,200}$/) });
export const taskSourceContextRead = defineAction<typeof taskSourceContextReadInput, TaskDashboardContext<z.output<typeof taskSourceContextReadInput>>, Response>({
  input: taskSourceContextReadInput,
  http: { method: "GET", path: "/api/tasks/source-context" },
  mcp: { reason: "The dashboard reads Jira source context within the selected task profile." },
  handler: (input, context) => context.execute(input),
});

export const taskSourceContextWriteInput = z.object({
  taskId: z.string().regex(/^[\w-]{1,200}$/),
  action: z.enum(["refresh", "acknowledge"]),
  revision: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  briefRevision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
export const taskSourceContextWrite = defineAction<typeof taskSourceContextWriteInput, TaskDashboardContext<z.output<typeof taskSourceContextWriteInput>>, Response>({
  input: taskSourceContextWriteInput,
  http: { method: "POST", path: "/api/tasks/source-context" },
  mcp: { reason: "Refreshing or acknowledging source revisions is a profile-scoped dashboard review workflow." },
  handler: (input, context) => context.execute(input),
});
