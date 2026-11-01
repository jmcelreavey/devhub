import { z } from "zod";
import { TASK_NOTE_OP_NAMES, TASK_NOTE_SECTION_KEYS, type TaskNoteView } from "../task-note/sections.ts";
import { TASK_QA_GOAL_LIMIT } from "../task-note/qa-scenario.ts";
import { TASK_STATUS_UPDATE_INSTRUCTION } from "../task-note/status-update.ts";
import { defineAction } from "./define.ts";

const taskNoteLinkInput = z.object({
  kind: z.string().describe("pr, jira, repo, preview, note, diagram, …"),
  label: z.string().optional().describe("Pill text"),
  href: z.string().optional().describe("http(s) URL or in-app path; makes the pill clickable"),
  id: z.string().optional().describe("Stable id within the kind (defaults to href or label)"),
});

const taskQaScenarioInput = z.object({
  goals: z.array(z.object({
    description: z.string().min(1).max(200),
    assertion: z.enum(["text", "visible"]),
    selector: z.string().min(1).max(300),
    expected: z.string().max(300).optional(),
  }).strict()).min(1).max(TASK_QA_GOAL_LIMIT),
}).strict();

export const taskNoteUpdateInput = z.object({
  op: z.enum([...TASK_NOTE_OP_NAMES, "read"]).describe("Operation to apply"),
  taskId: z.string().optional().describe("Task id; the note path is resolved for you"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Task day (defaults to the task's start date)"),
  notePath: z.string().optional().describe("task-notes/<date>-<id>, instead of taskId"),
  qaScenario: taskQaScenarioInput.optional().describe("set_qa_scenario: task-specific text or visibility assertions; no URLs or actions"),
  baselineRequired: z.boolean().optional().describe("set_qa_scenario: true only when a before capture is required, before implementation starts"),
  statusUpdate: z.object({ summary: z.string().trim().min(1).max(1000), whatChanged: z.string().trim().min(1).max(1000), currentState: z.string().trim().min(1).max(1000), nextStep: z.string().trim().min(1).max(1000) }).optional().describe("Structured milestone context for set_status_update"),
  text: z.string().nullish().describe("Body text (set_summary, set_status, add_question)"),
  options: z.array(z.string()).max(6).nullish().describe("add_question: short suggested answers the user can pick with one click"),
  title: z.string().nullish().describe("Decision, bug or waypoint title"),
  why: z.string().nullish().describe("Decision rationale"),
  alternatives: z.array(z.string()).nullish().describe("Decision alternatives that were rejected"),
  details: z.string().nullish().describe("Bug details"),
  resolution: z.string().nullish().describe("set_bug_status: one sentence on what was done about the bug and where (shown on the finding once it is fixed)"),
  note: z.string().nullish().describe("Point-of-interest explanation"),
  file: z.string().nullish().describe("Point-of-interest file path"),
  message: z.string().nullish().describe("Log message"),
  status: z.string().nullish().describe("Task status (set_status/set_meta) or bug status (add_bug/set_bug_status)"),
  severity: z.string().nullish(),
  done: z.boolean().nullish().describe("Waypoint done (default true)"),
  id: z.string().nullish().describe("Item id from a previous result"),
  match: z.string().nullish().describe("Text that identifies one existing item"),
  answer: z.string().nullish().describe("Answer to a question"),
  reopen: z.boolean().nullish(),
  localFile: z.string().nullish().describe("Absolute path of a screenshot or recording to attach"),
  assetPath: z.string().nullish().describe("Notes-relative asset path already in the vault"),
  url: z.string().nullish().describe("http(s) media URL"),
  caption: z.string().nullish(),
  phase: z.enum(["before", "after"]).nullish(),
  kind: z.enum(["image", "video"]).nullish(),
  section: z.enum(TASK_NOTE_SECTION_KEYS).nullish().describe("remove_item / clear_section target"),
  tags: z.array(z.string()).nullish(),
  models: z.array(z.string()).nullish(),
  links: z.array(taskNoteLinkInput).nullish(),
  addTags: z.array(z.string()).nullish(),
  addModels: z.array(z.string()).nullish(),
  addLinks: z.array(taskNoteLinkInput).nullish(),
  rank: z.string().nullish(),
  at: z.string().nullish(),
}).passthrough().meta({ additionalProperties: false });

export interface TaskNoteTarget {
  taskId?: string;
  date?: string;
  notePath?: string;
}

export interface TaskNoteValue {
  notePath: string;
  changed: boolean;
  migrated: boolean;
  created: boolean;
  message: string;
  view: TaskNoteView;
}

export type TaskNoteOutcome =
  | { ok: true; value: TaskNoteValue }
  | { ok: false; error: string; notFound: boolean };

export interface TaskNoteContext {
  update: (target: TaskNoteTarget, fields: Record<string, unknown>) => TaskNoteValue | Promise<TaskNoteValue>;
  classifyError: (error: unknown) => { error: string; notFound: boolean } | null;
}

export const taskNoteUpdate = defineAction<typeof taskNoteUpdateInput, TaskNoteContext, TaskNoteOutcome>({
  input: taskNoteUpdateInput,
  http: { method: "POST", path: "/api/tasks/note/sections" },
  mcp: {
    name: "task_note_update",
    toolset: "tasks",
    description: TASK_STATUS_UPDATE_INSTRUCTION + " Keep a task's note tidy with one section-level operation (never free-form text appends). " +
      "The note shows Summary, Status, Questions for you, Decisions, Screenshots and video, Bugs, Points of interest, Waypoints and Log as a visual page; " +
      "your sections are rewritten, the user's own sections are never touched. Repeat calls are safe: decisions, bugs, waypoints, points of interest and media are matched by title/file/url and updated in place. " +
      "Ops: set_qa_scenario{qaScenario?,baselineRequired?} records bounded read-only assertions and an optional required-before marker without replacing other note content; " +
      "set_summary{text} replace the 2-3 line summary; set_status{status?,text?} (status: todo|planning|in-progress|needs-you|blocked|draft-pr|ready-for-review|done; text = step, PR, next action); " +
      "add_question{text,options?: up to 6 short suggested answers shown as buttons}; resolve_question{id|match,answer?,reopen?}; add_decision{title,why?,alternatives?}; " +
      "add_media{localFile|assetPath|url,caption?,phase?:before|after,kind?} (localFile = absolute path to a png/jpg/gif/webp/mp4 on this machine, copied into the vault); " +
      "add_bug{title,details?,severity?,status?}; set_bug_status{id|match,status:open|fixed|wontfix,resolution?: what you did}; add_waypoint{title,done?}; add_poi{file?,note}; append_log{message}; " +
      "set_meta{status?,tags?,models?,links? to replace, addTags?,addModels?,addLinks? to merge}; remove_item{section,id|match}; clear_section{section}; read (returns open questions with ids, writes nothing). " +
      "Identify the note by taskId (+date) or notePath. A missing note is created from the task. " +
      "Agents working a task: call this as you go, not only at the end. Whenever your step changes, set_status (it moves the Storyboard card) and set_summary; add_media for screenshots after UI changes; add_decision for choices; add_question instead of guessing. " +
      "Tidy as you go: rewrite the summary instead of growing it, resolve answered questions, mark fixed bugs, and remove_item / clear_section stale or duplicate entries so the note reads as the current state (append_log keeps history). DevHub records each agent update and shows it on the card.",
  },
  handler: async ({ taskId, date, notePath, ...fields }, context) => {
    try {
      return { ok: true, value: await context.update({ taskId, date, notePath }, fields) };
    } catch (error) {
      const known = context.classifyError(error);
      if (!known) throw error;
      return { ok: false, ...known };
    }
  },
});

export const taskNoteReadInput = taskNoteUpdateInput.pick({ taskId: true, date: true, notePath: true });

export const taskNoteRead = defineAction<typeof taskNoteReadInput, TaskNoteContext, TaskNoteOutcome>({
  input: taskNoteReadInput,
  http: { method: "GET", path: "/api/tasks/note/sections" },
  mcp: { reason: "MCP reads use task_note_update with op=read." },
  handler: (input, context) => taskNoteUpdate.handler({ ...input, op: "read" }, context),
});

export const taskNoteAddInput = z.object({
  id: z.string().trim().regex(/^[A-Za-z0-9_-]{1,128}$/).describe("Task ID or linked Jira ticket key"),
  text: z.string().trim().min(1).max(4000),
  updateAgent: z.boolean().optional(),
  noteId: z.string().min(1).max(128).optional(),
  confirmStop: z.boolean().optional(),
}).meta({ additionalProperties: false });

export type TaskNoteAddInput = z.output<typeof taskNoteAddInput>;

export const taskNoteCapabilityInput = z.object({ taskId: z.string() });
export const taskNoteCapabilityRead = defineAction<typeof taskNoteCapabilityInput, { read: (taskId: string) => Promise<unknown> }, unknown>({
  input: taskNoteCapabilityInput,
  http: { method: "GET", path: "/api/tasks/note/add" },
  mcp: { reason: "The dashboard checks whether a task agent can accept a note before offering the action." },
  handler: ({ taskId }, context) => context.read(taskId),
});

export interface TaskNoteAddValue {
  saved: boolean;
  note: { id: string; text: string; at: string };
  capability: { running: boolean };
  agent: { mode: string; runId?: string; error?: string };
}

export interface TaskNoteAddContext {
  add: (input: TaskNoteAddInput) => Promise<TaskNoteAddValue>;
  classifyError: (error: unknown) => { error: string; status: number } | null | Promise<{ error: string; status: number } | null>;
}

export type TaskNoteAddOutcome =
  | { ok: true; id: string; value: TaskNoteAddValue }
  | { ok: false; id: string; error: string; status: number };

export const taskNoteAdd = defineAction<typeof taskNoteAddInput, TaskNoteAddContext, TaskNoteAddOutcome>({
  input: taskNoteAddInput,
  http: { method: "POST", path: "/api/tasks/note/add" },
  mcp: { name: "task_note_add", toolset: "tasks", description: "Append a timestamped human note to a task (task ID or Jira key). Save alone never touches a running agent. Set updateAgent only with explicit consent to send live guidance or stop and continue its current stage. A saved noteId retries delivery without appending again. Requires the dashboard." },
  handler: async (input, context) => {
    try {
      return { ok: true, id: input.id, value: await context.add(input) };
    } catch (error) {
      const known = await context.classifyError(error);
      if (!known) throw error;
      return { ok: false, id: input.id, ...known };
    }
  },
});

export const taskNotePillsInput = z.object({
  taskId: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notePath: z.string().optional().describe("task-notes/<date>-<id>"),
}).meta({ additionalProperties: false });

export interface TaskNotePillsContext {
  resolve: (input: z.output<typeof taskNotePillsInput>) => Promise<{ target: string } | { error: string }>;
  read: (target: string) => unknown | null;
}

export type TaskNotePillsResult = { pills: unknown } | { error: string };

export const taskNotePills = defineAction<typeof taskNotePillsInput, TaskNotePillsContext, TaskNotePillsResult>({
  input: taskNotePillsInput,
  http: { reason: "The dashboard derives pills from task-note sections; no separate pills endpoint exists." },
  mcp: { name: "task_note_pills", toolset: "tasks", description: "The pills at the top of a task note — status, tags, links (PR, Jira, repo, preview, notes) and models — with where each one goes in DevHub. Change status with task_note_update set_status; tags/links/models with set_meta." },
  handler: async (input, context) => {
    const resolved = await context.resolve(input);
    if ("error" in resolved) return resolved;
    const pills = context.read(resolved.target);
    return pills ? { pills } : { error: `No note at ${resolved.target}` };
  },
});

export const taskNotesByTagInput = z.object({
  tag: z.string().describe("Tag without #"),
  limit: z.number().int().min(1).max(100).optional(),
}).meta({ additionalProperties: false });

export interface TaskNotesByTagContext {
  find: (tag: string) => unknown[];
}

export const taskNotesByTag = defineAction<typeof taskNotesByTagInput, TaskNotesByTagContext, { tag: string; matches: unknown[] }>({
  input: taskNotesByTagInput,
  http: { reason: "The dashboard tag filter reads its own task-tag index; no equivalent tag-search endpoint exists." },
  mcp: { name: "task_notes_by_tag", toolset: "tasks", description: "Task notes carrying a tag (metadata tags or #tag in the title), newest first, with status — the same filter as clicking a tag pill." },
  handler: ({ tag, limit }, context) => ({ tag, matches: context.find(tag).slice(0, limit ?? 25) }),
});
