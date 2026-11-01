import { updateTaskNoteContent } from "../../../../packages/shared/task-note/content.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../context.ts";
import { taskNotePills, taskNotesByTag, taskNoteUpdate } from "../../../../packages/shared/actions/task-note.ts";
import { taskStorage } from "../../../../apps/core/src/domains/storage/tasks.ts";
import { registerAction } from "../actions/register.ts";
import { textToBlocks } from "../convert.ts";
import { buildTaskNoteMarkdown } from "../../../../packages/shared/task-note/index.ts";
import { TaskNoteOpError } from "../../../../packages/shared/task-note/sections.ts";
import fs from "node:fs";
import { ContentConflictError, type ContentStorage } from "../../../../packages/shared/storage/content.ts";
import { createFileContentStorage } from "../../../../packages/shared/storage/file-content.ts";
import path from "node:path";
import { readTaskNoteWithMigration } from "../../../../packages/shared/task-note/sections.ts";
import { TaskNoteNotFoundError, describeTaskNote } from "../../../../packages/shared/task-note/update.ts";
import { agentCallerFromEnv } from "../../../../packages/shared/task-note/agent-updates.ts";

/** An agent's write is recorded so the Storyboard card can say when an agent last touched the note. A person's is not. */
export async function recordIfAgent(notesRoot: string, notePath: string, op: string, env: Record<string, string | undefined> = process.env, now = new Date(), storage: ContentStorage = createFileContentStorage(notesRoot)): Promise<boolean> {
  if (op === "read") return false;
  const caller = agentCallerFromEnv(env);
  if (!caller) return false;
  const file = ".config/task-note-agent-updates.json";
  try {
    for (let attempt = 0; ; attempt++) {
      const current = await storage.assets.read(file);
      const all: Record<string, { at: string; op: string; runId?: string; depth?: number }> = {};
      if (current) {
        const raw: unknown = JSON.parse(current.content.toString("utf8"));
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          for (const [key, value] of Object.entries(raw)) {
            if (value && typeof value === "object" && typeof value.at === "string" && typeof value.op === "string") all[key] = value as typeof all[string];
          }
        }
      }
      all[notePath] = { at: now.toISOString(), op, ...caller };
      const kept = Object.entries(all).sort(([, a], [, b]) => b.at.localeCompare(a.at)).slice(0, 1000);
      try {
        await storage.assets.write(file, JSON.stringify(Object.fromEntries(kept), null, 2) + "\n", current?.revision ?? null);
        return true;
      } catch (error) {
        if (!(error instanceof ContentConflictError) || attempt >= 1) throw error;
      }
    }
  } catch {
    // Bookkeeping only: never fail the agent's note write over it.
    return false;
  }
}

export function registerTaskNoteTools(server: McpServer, ctx: Context): void {
  registerAction(server, taskNoteUpdate, {
    update: async ({ taskId, date, notePath }, fields) => {
        let target = notePath;
        let scaffold: (() => unknown[]) | undefined;
        if (!target) {
          if (!taskId) throw new TaskNoteOpError("taskId or notePath is required");
          await ctx.tasksStorage.ready();
          const task = await taskStorage(ctx.tasksDir).find(taskId);
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
        const result = await updateTaskNoteContent(ctx.noteContent, target, fields, { notesRoot: ctx.notesDir, scaffold });
        if (result.changed && typeof fields.op === "string") await recordIfAgent(ctx.notesDir, result.notePath, fields.op, process.env, new Date(), ctx.noteContent);
        return result;
    },
    classifyError: (error) => error instanceof TaskNoteOpError || error instanceof ContentConflictError
      ? { error: error.message, notFound: error instanceof TaskNoteNotFoundError }
      : null,
  }, (result) => result.ok
    ? { content: [{ type: "text", text: describeTaskNote(result.value) }] }
    : { content: [{ type: "text", text: result.error }], isError: true });

  registerAction(server, taskNotePills, {
    resolve: async ({ taskId, date, notePath }) => {
      if (notePath) return { target: notePath };
      if (!taskId) return { error: "taskId or notePath is required" };
      await ctx.tasksStorage.ready();
      const task = await taskStorage(ctx.tasksDir).find(taskId);
      if (!task) return { error: `Task ${taskId} not found` };
      return { target: ctx.tasksStorage.resolveNotePath(task, date ?? task.startDate) };
    },
    read: (target) => readNotePills(ctx.notesDir, target),
  }, (result) => "error" in result
    ? { content: [{ type: "text", text: result.error }], isError: true }
    : { content: [{ type: "text", text: JSON.stringify(result.pills, null, 2) }] });

  registerAction(server, taskNotesByTag, {
    find: (tag) => notesByTag(ctx.notesDir, tag),
  }, ({ tag, matches }) => ({
    content: [{ type: "text", text: matches.length ? JSON.stringify(matches, null, 2) : `No task notes tagged #${tag.replace(/^#/, "")}.` }],
  }));
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
