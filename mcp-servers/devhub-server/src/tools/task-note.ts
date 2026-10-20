import { TASK_STATUS_UPDATE_INSTRUCTION } from "../../../../shared/task-note/status-update.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import { textToBlocks } from "../convert.ts";
import { findTask } from "../../../../shared/tasks/store.ts";
import { buildTaskNoteMarkdown } from "../../../../shared/task-note/index.ts";
import { TASK_NOTE_OP_NAMES, TASK_NOTE_SECTION_KEYS, TaskNoteOpError } from "../../../../shared/task-note/sections.ts";
import fs from "node:fs";
import path from "node:path";
import { readTaskNoteWithMigration } from "../../../../shared/task-note/sections.ts";
import { TaskNoteNotFoundError, describeTaskNote, updateTaskNote } from "../../../../shared/task-note/update.ts";
import { agentCallerFromEnv, recordAgentNoteUpdate } from "../../../../shared/task-note/agent-updates.ts";

/** An agent's write is recorded so the Storyboard card can say when an agent last touched the note. A person's is not. */
export function recordIfAgent(notesRoot: string, notePath: string, op: string, env: Record<string, string | undefined> = process.env, now = new Date()): boolean {
  if (op === "read") return false;
  const caller = agentCallerFromEnv(env);
  if (!caller) return false;
  try {
    recordAgentNoteUpdate(notesRoot, notePath, { at: now.toISOString(), op, ...caller });
    return true;
  } catch {
    // Bookkeeping only: never fail the agent's note write over it.
    return false;
  }
}

const linkSchema = z.object({
  kind: z.string().describe("pr, jira, repo, preview, note, diagram, …"),
  label: z.string().describe("Pill text"),
  href: z.string().optional().describe("http(s) URL or in-app path; makes the pill clickable"),
  id: z.string().optional().describe("Stable id within the kind (defaults to href or label)"),
});

export function registerTaskNoteTools(server: McpServer, ctx: Context): void {
  server.registerTool(
    "task_note_update",
    {
      description:
        TASK_STATUS_UPDATE_INSTRUCTION + " Keep a task's note tidy with one section-level operation (never free-form text appends). " +
        "The note shows Summary, Status, Questions for John, Decisions, Screenshots and video, Bugs, Points of interest, Waypoints and Log as a visual page; " +
        "your sections are rewritten, John's own sections are never touched. Repeat calls are safe: decisions, bugs, waypoints, points of interest and media are matched by title/file/url and updated in place. " +
        "Ops: set_summary{text} replace the 2-3 line summary; set_status{status?,text?} (status: todo|planning|in-progress|needs-you|blocked|draft-pr|ready-for-review|done; text = step, PR, next action); " +
        "add_question{text,options?: up to 6 short suggested answers shown as buttons}; resolve_question{id|match,answer?,reopen?}; add_decision{title,why?,alternatives?}; " +
        "add_media{localFile|assetPath|url,caption?,phase?:before|after,kind?} (localFile = absolute path to a png/jpg/gif/webp/mp4 on this machine, copied into the vault); " +
        "add_bug{title,details?,severity?,status?}; set_bug_status{id|match,status:open|fixed|wontfix,resolution?: what you did}; add_waypoint{title,done?}; add_poi{file?,note}; append_log{message}; " +
        "set_meta{status?,tags?,models?,links? to replace, addTags?,addModels?,addLinks? to merge}; remove_item{section,id|match}; clear_section{section}; read (returns open questions with ids, writes nothing). " +
        "Identify the note by taskId (+date) or notePath. A missing note is created from the task. " +
        "Agents working a task: call this as you go, not only at the end. Whenever your step changes, set_status (it moves the Storyboard card) and set_summary; add_media for screenshots after UI changes; add_decision for choices; add_question instead of guessing. " +
        "Tidy as you go: rewrite the summary instead of growing it, resolve answered questions, mark fixed bugs, and remove_item / clear_section stale or duplicate entries so the note reads as the current state (append_log keeps history). DevHub records each agent update and shows it on the card.",
      inputSchema: {
        op: z.enum([...TASK_NOTE_OP_NAMES, "read"]).describe("Operation to apply"),
        taskId: z.string().optional().describe("Task id; the note path is resolved for you"),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Task day (defaults to the task's start date)"),
        notePath: z.string().optional().describe("task-notes/<date>-<id>, instead of taskId"),
        statusUpdate: z.object({ summary: z.string().trim().min(1).max(1000), whatChanged: z.string().trim().min(1).max(1000), currentState: z.string().trim().min(1).max(1000), nextStep: z.string().trim().min(1).max(1000) }).optional().describe("Structured milestone context for set_status_update"),
        text: z.string().optional().describe("Body text (set_summary, set_status, add_question)"),
        options: z.array(z.string()).max(6).optional().describe("add_question: short suggested answers John can pick with one click"),
        title: z.string().optional().describe("Decision, bug or waypoint title"),
        why: z.string().optional().describe("Decision rationale"),
        alternatives: z.array(z.string()).optional().describe("Decision alternatives that were rejected"),
        details: z.string().optional().describe("Bug details"),
        resolution: z.string().optional().describe("set_bug_status: one sentence on what was done about the bug and where (shown on the finding once it is fixed)"),
        note: z.string().optional().describe("Point-of-interest explanation"),
        file: z.string().optional().describe("Point-of-interest file path"),
        message: z.string().optional().describe("Log message"),
        status: z.string().optional().describe("Task status (set_status/set_meta) or bug status (add_bug/set_bug_status)"),
        severity: z.enum(["blocker", "high", "medium", "low"]).optional(),
        done: z.boolean().optional().describe("Waypoint done (default true)"),
        id: z.string().optional().describe("Item id from a previous result"),
        match: z.string().optional().describe("Text that identifies one existing item"),
        answer: z.string().optional().describe("Answer to a question"),
        reopen: z.boolean().optional(),
        localFile: z.string().optional().describe("Absolute path of a screenshot or recording to attach"),
        assetPath: z.string().optional().describe("Notes-relative asset path already in the vault"),
        url: z.string().optional().describe("http(s) media URL"),
        caption: z.string().optional(),
        phase: z.enum(["before", "after"]).optional(),
        kind: z.enum(["image", "video"]).optional(),
        section: z.enum(TASK_NOTE_SECTION_KEYS).optional().describe("remove_item / clear_section target"),
        tags: z.array(z.string()).optional(),
        models: z.array(z.string()).optional(),
        links: z.array(linkSchema).optional(),
        addTags: z.array(z.string()).optional(),
        addModels: z.array(z.string()).optional(),
        addLinks: z.array(linkSchema).optional(),
      },
    },
    async ({ taskId, date, notePath, ...fields }) => {
      try {
        let target = notePath;
        let scaffold: (() => unknown[]) | undefined;
        if (!target) {
          if (!taskId) throw new TaskNoteOpError("taskId or notePath is required");
          await ctx.tasksStorage.ready();
          const task = findTask(ctx.tasksDir, taskId);
          if (!task) throw new TaskNoteNotFoundError(`Task ${taskId} not found`);
          const day = date ?? task.startDate;
          target = ctx.tasksStorage.resolveNotePath(task, day);
          const resolved = target;
          scaffold = () =>
            textToBlocks(
              buildTaskNoteMarkdown({
                id: task.id,
                text: task.text,
                date: day,
                jiraKey: task.jiraKey,
                notePath: resolved,
                related: task.links,
              }),
            );
        }
        const result = updateTaskNote(ctx.storage, target, fields, { notesRoot: ctx.notesDir, scaffold });
        // A repeat that changed nothing is not an edit: the card says "An agent edited the note", so don't re-stamp it.
        if (result.changed) recordIfAgent(ctx.notesDir, result.notePath, fields.op);
        return { content: [{ type: "text" as const, text: describeTaskNote(result) }] };
      } catch (error) {
        if (error instanceof TaskNoteOpError) {
          return { content: [{ type: "text" as const, text: error.message }], isError: true };
        }
        throw error;
      }
    },
  );

  server.registerTool(
    "task_note_pills",
    {
      description:
        "The pills at the top of a task note — status, tags, links (PR, Jira, repo, preview, notes) and models — with where each one goes in DevHub. " +
        "Change status with task_note_update set_status; tags/links/models with set_meta.",
      inputSchema: {
        taskId: z.string().optional(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        notePath: z.string().optional().describe("task-notes/<date>-<id>"),
      },
    },
    async ({ taskId, date, notePath }) => {
      let target = notePath;
      if (!target) {
        if (!taskId) return { content: [{ type: "text" as const, text: "taskId or notePath is required" }], isError: true };
        await ctx.tasksStorage.ready();
        const task = findTask(ctx.tasksDir, taskId);
        if (!task) return { content: [{ type: "text" as const, text: `Task ${taskId} not found` }], isError: true };
        target = ctx.tasksStorage.resolveNotePath(task, date ?? task.startDate);
      }
      const pills = readNotePills(ctx.notesDir, target);
      if (!pills) return { content: [{ type: "text" as const, text: `No note at ${target}` }], isError: true };
      return { content: [{ type: "text" as const, text: JSON.stringify(pills, null, 2) }] };
    },
  );

  server.registerTool(
    "task_notes_by_tag",
    {
      description: "Task notes carrying a tag (metadata tags or #tag in the title), newest first, with status — the same filter as clicking a tag pill.",
      inputSchema: { tag: z.string().describe("Tag without #"), limit: z.number().int().min(1).max(100).optional() },
    },
    async ({ tag, limit }) => {
      const matches = notesByTag(ctx.notesDir, tag).slice(0, limit ?? 25);
      const text = matches.length ? JSON.stringify(matches, null, 2) : `No task notes tagged #${tag.replace(/^#/, "")}.`;
      return { content: [{ type: "text" as const, text }] };
    },
  );
}

export interface NotePills {
  notePath: string;
  title: string;
  status?: string;
  statusHref?: string;
  tags: Array<{ tag: string; href: string }>;
  links: Array<{ kind: string; label: string; href?: string }>;
  models: Array<{ model: string; href: string }>;
}

/** Same destinations as the GUI pills (TaskNoteVisual). */
export function readNotePills(notesDir: string, notePath: string): NotePills | null {
  const rel = notePath.replace(/\.json$/, "");
  const file = path.join(notesDir, `${rel}.json`);
  if (!path.resolve(file).startsWith(path.resolve(notesDir) + path.sep) || !fs.existsSync(file)) return null;
  const view = readTaskNoteWithMigration(JSON.parse(fs.readFileSync(file, "utf8")) as unknown[]);
  const meta = view.meta ?? {};
  const titleTags = [...(view.title ?? "").matchAll(/#([\w-]+)/g)].map((m) => m[1]);
  const tags = [...new Set([...(meta.tags ?? []), ...titleTags])];
  return {
    notePath: rel,
    title: view.title,
    ...(meta.status ? { status: meta.status, statusHref: `/notes/${rel}` } : {}),
    tags: tags.map((tag) => ({ tag, href: `/work?tab=tasks&tag=${encodeURIComponent(tag)}` })),
    links: (meta.links ?? []).map((link) => ({ kind: link.kind, label: link.label, href: link.href ?? `/work?tab=tasks&q=${encodeURIComponent(link.id || link.label)}` })),
    models: (meta.models ?? []).map((model) => ({ model, href: "/storyboard?settings=model-tiers" })),
  };
}

export function notesByTag(notesDir: string, rawTag: string): Array<{ notePath: string; title: string; status?: string }> {
  const tag = rawTag.replace(/^#/, "").toLowerCase();
  const dir = path.join(notesDir, "task-notes");
  if (!fs.existsSync(dir)) return [];
  const out: Array<{ notePath: string; title: string; status?: string; mtime: number }> = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const pills = readNotePills(notesDir, `task-notes/${name}`);
      if (pills?.tags.some((t) => t.tag.toLowerCase() === tag)) {
        out.push({ notePath: pills.notePath, title: pills.title, status: pills.status, mtime: fs.statSync(path.join(dir, name)).mtimeMs });
      }
    } catch { /* unreadable note: skip */ }
  }
  return out.sort((a, b) => b.mtime - a.mtime).map(({ mtime: _mtime, ...rest }) => rest);
}
