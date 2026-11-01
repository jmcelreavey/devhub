import { z } from "zod";
import { defineAction } from "../../../../packages/shared/actions/define.ts";
import { ContentConflictError, type ContentStorage } from "../../../../packages/shared/storage/content.ts";
import { assertNoteAssetRelPath } from "../../../../packages/shared/notes-assets/index.ts";
import { withPrReviewEntityLinks } from "../../../../packages/shared/pr-note/index.ts";
import { appendNote, noteFilePath, readNote, writeNote } from "../content-storage.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Context } from "../context.ts";
import { isWorkspaceNoteRel, type TreeEntry } from "../storage.ts";
import { requestAction, withDashboardErrors, type DashboardToolResult } from "../dashboard-client.ts";
import { flattenTree } from "../shared.ts";
import { blocksToText, textToBlocks } from "../convert.ts";
import {
  buildMeetingNoteMarkdown,
  meetingNotePath,
  type MeetingNoteEvent,
} from "../../../../packages/shared/meeting-note/index.ts";
import {
  buildTaskNoteMarkdown,
  taskNotePath,
  type TaskNoteSource,
} from "../../../../packages/shared/task-note/index.ts";
import { buildPrNoteMarkdown, prNotePath } from "../../../../packages/shared/pr-note/index.ts";
import { defaultHrefForRef, parseEntityLinksFromMarkdown } from "../../../../packages/shared/entity-note/index.ts";
import type { EntityRef } from "../../../../packages/shared/entity-note/index.ts";
import { notesAppend, notesDelete, notesRead, notesWrite, notesList, notesDevhubOpen, notesSearch, notesCreateMeeting, notesCreateTask, notesCreatePr } from "../../../../packages/shared/actions/notes.ts";
import { repoCursorDraftApply, repoCursorDraftDelete, repoCursorOpen } from "../../../../packages/shared/actions/repos.ts";
import { noteAssetWrite } from "../../../../packages/shared/actions/note-assets.ts";
import { entityLinksRead, entityLinksResolve } from "../../../../packages/shared/actions/entity-links.ts";
import { desktopNavigation } from "../../../../packages/shared/actions/ui.ts";
import { registerAction } from "../actions/register.ts";

async function withContentErrors(operation: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof ContentConflictError)) throw error;
    return { content: [{ type: "text", text: "Conflict: content changed. Read it again before writing." }], isError: true };
  }
}

/** Workspace slice surfaced by notes_list / notes_search: daily/ + root .json. */
function filterAgentNoteTree(entries: TreeEntry[]): TreeEntry[] {
  const daily = entries.find((e) => e.type === "dir" && e.name === "daily");
  const rootJson = entries.filter((e) => e.type === "file" && e.name.endsWith(".json"));
  const out: TreeEntry[] = [];
  if (daily) out.push(daily);
  out.push(...rootJson);
  return out;
}

export function registerNotesTools(server: McpServer, ctx: Context): void {
  const { storage, noteContent, notesDir, dashboard } = ctx;

  registerAction(server, notesList, { execute: async () => {
      const tree = filterAgentNoteTree(storage.list());
      const lines = flattenTree(tree);
      return {
        content: [
          {
            type: "text",
            text: lines.length > 0 ? `Notes in ${notesDir}:\n${lines.join("\n")}` : "No notes found",
          },
        ],
      };
    } },
    (result) => result as DashboardToolResult, undefined, { omitInputSchema: true });

  registerAction(server, defineAction({
    ...notesRead,
    handler: async ({ path }, content: ContentStorage) => ({ path, file: await readNote(content, path) }),
  }), noteContent, ({ path, file }) => {
    if (!file) return { content: [{ type: "text", text: `Note not found: ${path}\nRevision: null` }] };
    const blocks = file.content as unknown[];
    const text = blocksToText(Array.isArray(blocks) ? blocks : [blocks]);
    return { content: [{ type: "text", text: `# ${file.path}\nRevision: ${file.revision}\n\n${text}` }] };
  });

  registerAction(server, defineAction({
    ...notesWrite,
    input: notesWrite.input.extend({ expectedRevision: z.string().nullable().describe("Revision from notes_read; null creates only") }),
    handler: async ({ path, content, expectedRevision }, storage: ContentStorage) => {
      const markdown = path.replace(/^\/+/, "").startsWith("pr-reviews/") ? withPrReviewEntityLinks(content) : content;
      const file = await writeNote(storage, path, textToBlocks(markdown), expectedRevision);
      return { path, file, existed: expectedRevision !== null };
    },
  }), noteContent, ({ path, file, existed }) => ({
    content: [{ type: "text", text: `${existed ? "Updated" : "Created"}: ${path}\nRevision: ${file.revision}` }],
  }), withContentErrors);

  registerAction(server, notesDevhubOpen, { execute: async ({ path: notePath }) => {
      const note = storage.read(notePath);
      if (!note) return { content: [{ type: "text", text: `Note not found: ${notePath}` }], isError: true };
      const id = note.path.replace(/\.json$/i, "");
      const href = defaultHrefForRef({ kind: "note", id, label: id });
      if (!href) return { content: [{ type: "text", text: `Could not resolve note path: ${notePath}` }], isError: true };

      return withDashboardErrors(async () => {
        const result = await requestAction<{ suppressed?: boolean }>(dashboard, desktopNavigation.http, { body: { href, newTab: true } });
        if (result?.suppressed) return { content: [{ type: "text", text: `Ready: ${href}. Share this link with the user; agent work does not change their screen.` }] };
        return { content: [{ type: "text", text: `Opened ${id} in a new DevHub workspace tab.` }] };
      });
    } },
    (result) => result as DashboardToolResult);

  registerAction(server, repoCursorOpen, {
    open: async ({ path, repoName, worktree }) => ({
      status: 200,
      body: await dashboard.post(`/api/repos/${encodeURIComponent(repoName)}/open`, { notePath: path, ...(worktree ? { worktree } : {}) }),
    }),
  }, ({ path, response }) => {
    const result = response.body as { writable: boolean; path: string };
    return { content: [{
      type: "text",
      text: result.writable
        ? `Opened ${path} in Cursor beside ${result.path}. Edit the Markdown copy, then use notes_cursor_apply.`
        : `Opened ${path} in Cursor beside ${result.path} as read-only Markdown; rich blocks prevent safe write-back.`,
    }] };
  }, (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult));

  registerAction(server, repoCursorDraftApply, {
    apply: async (repoName, path) => ({ status: 200, body: await dashboard.patch(`/api/repos/${encodeURIComponent(repoName)}/open`, { notePath: path }) }),
  }, ({ path }) => ({ content: [{ type: "text", text: `Applied Cursor changes to ${path}.` }] }),
  (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult));

  registerAction(server, repoCursorDraftDelete, {
    remove: async (repoName, path) => ({ status: 200, body: await dashboard.delete(`/api/repos/${encodeURIComponent(repoName)}/open`, { notePath: path }) }),
  }, ({ path }) => ({ content: [{ type: "text", text: `Deleted the Cursor working copy for ${path}.` }] }),
  (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult));

  registerAction(server, defineAction({
    ...noteAssetWrite,
    input: noteAssetWrite.input.extend({ expectedRevision: z.string().nullable().describe("Current asset revision; null creates only") }),
    handler: async ({ path, contentBase64, expectedRevision }, content: ContentStorage) => {
      const normalized = assertNoteAssetRelPath(path);
      const data = Buffer.from(contentBase64, "base64");
      if (!data.length) throw new Error("Empty asset content");
      return content.assets.write(normalized, data, expectedRevision);
    },
  }), noteContent, (file) => ({
    content: [{ type: "text", text: `Wrote asset: ${file.path} (${file.size} bytes). Revision: ${file.revision}. Reference in markdown as ![caption](${file.path})` }],
  }), withContentErrors);

  registerAction(server, defineAction({
    ...notesAppend,
    handler: async ({ path, content }, storage: ContentStorage) => ({ path, ...await appendNote(storage, path, textToBlocks(content)) }),
  }), noteContent, ({ path, existed, file }) => ({
    content: [{ type: "text", text: `${existed ? "Appended to" : "Created (was new)"}: ${path}\nRevision: ${file.revision}` }],
  }), withContentErrors);

  registerAction(server, notesSearch, { execute: async ({ query }) => {
      const results = await noteContent.search(query, { includePath: isWorkspaceNoteRel, includeTldraw: false });
      if (results.length === 0) {
        return { content: [{ type: "text", text: `No results for "${query}"` }] };
      }
      const grouped: Record<string, typeof results> = {};
      for (const r of results) {
        if (!grouped[r.path]) grouped[r.path] = [];
        grouped[r.path].push(r);
      }
      const output = Object.entries(grouped)
        .map(([file, matches]) => {
          const lines = matches.map((m) => `  L${m.line}: ${m.text}`).join("\n");
          return `**${file}**\n${lines}`;
        })
        .join("\n\n");
      return {
        content: [{ type: "text", text: `Found ${results.length} match(es) for "${query}":\n\n${output}` }],
      };
    } },
    (result) => result as DashboardToolResult);

  registerAction(server, defineAction({
    ...notesDelete,
    input: notesDelete.input.extend({ expectedRevision: z.string().describe("Revision from notes_read") }),
    handler: async ({ path, expectedRevision }, storage: ContentStorage) => ({ path, deleted: await storage.delete(noteFilePath(path), expectedRevision) }),
  }), noteContent, ({ path, deleted }) => ({
    content: [{ type: "text", text: `${deleted ? "Deleted" : "Not found"}: ${path}` }],
  }), withContentErrors);

  registerAction(server, notesCreateMeeting, { execute: async ({ title, start, end, isAllDay, location, conferenceUrl, htmlLink, attendees, overwrite }) => {
      const event: MeetingNoteEvent = {
        title,
        start,
        end,
        isAllDay,
        location,
        conferenceUrl,
        htmlLink,
        attendees,
      };
      const path = meetingNotePath(event);
      const existing = await readNote(noteContent, path);
      if (existing && overwrite === false) {
        return {
          content: [
            {
              type: "text",
              text: `Already exists: ${path}\nOpen in DevHub notes UI or notes_read this path.`,
            },
          ],
        };
      }
      const markdown = buildMeetingNoteMarkdown(event);
      await writeNote(noteContent, path, textToBlocks(markdown), existing?.revision ?? null);
      return {
        content: [
          {
            type: "text",
            text: `${existing ? "Updated" : "Created"}: ${path}\n\n${markdown}`,
          },
        ],
      };
    } },
    (result) => result as DashboardToolResult, withContentErrors);

  registerAction(server, notesCreateTask, { execute: async ({ id, text, date, jiraKey, jiraUrl, overwrite }) => {
      await ctx.tasksStorage.ready();
      const task = ctx.tasksStorage.getDay(date).tasks.find((t) => t.id === id || t.legacyIds?.includes(id))
        ?? { id, text, done: false, createdAt: date, startDate: date, rank: "0" };
      const notePath = ctx.tasksStorage.resolveNotePath(task, date);
      const source: TaskNoteSource = { id, text, date, jiraKey, jiraUrl, notePath };
      const path = taskNotePath(source);
      const existing = await readNote(noteContent, path);
      if (existing && overwrite !== true) {
        return {
          content: [
            {
              type: "text",
              text: `Already exists: ${path}\nOpen in DevHub notes UI or notes_read this path.`,
            },
          ],
        };
      }
      const markdown = buildTaskNoteMarkdown(source);
      await writeNote(noteContent, path, textToBlocks(markdown), existing?.revision ?? null);
      return {
        content: [
          {
            type: "text",
            text: `${existing ? "Updated" : "Created"}: ${path}\n\n${markdown}`,
          },
        ],
      };
    } },
    (result) => result as DashboardToolResult, withContentErrors);

  registerAction(server, notesCreatePr, { execute: async ({ repo, number, title, url, overwrite }) => {
      const source = { repo, number, title, url };
      const path = prNotePath(source);
      const existing = await readNote(noteContent, path);
      if (existing && overwrite !== true) {
        return {
          content: [{ type: "text", text: `Already exists: ${path}` }],
        };
      }
      const markdown = buildPrNoteMarkdown(source);
      await writeNote(noteContent, path, textToBlocks(markdown), existing?.revision ?? null);
      return {
        content: [
          {
            type: "text",
            text: `${existing ? "Updated" : "Created"}: ${path}\n\n${markdown}`,
          },
        ],
      };
    } },
    (result) => result as DashboardToolResult, withContentErrors);

  registerAction(server, entityLinksRead, { execute: async ({ path: filePath }) => {
      const note = storage.read(filePath);
      if (!note) {
        return { content: [{ type: "text", text: `Not found: ${filePath}` }] };
      }
      // NoteResult.content is `unknown`; normalize to an array like notes_read does.
      const md = blocksToText(Array.isArray(note.content) ? note.content : [note.content]);
      const refs = parseEntityLinksFromMarkdown(md);
      return {
        content: [
          {
            type: "text",
            text:
              refs.length === 0
                ? `No EntityRefs in ${filePath}`
                : refs.map((r: EntityRef) => `- ${r.kind}:${r.id} — ${r.label}${r.href ? ` (${r.href})` : ""}`).join("\n"),
          },
        ],
      };
    } },
    (result) => result as DashboardToolResult);

  registerAction(server, entityLinksResolve, { execute: async ({ kind, id, date, depth }) =>
      // Dashboard-backed on purpose, same reasoning as tags: the graph walk and
      // rollover lineage live in the dashboard process. A second copy here
      // would be a second thing to keep in sync.
      withDashboardErrors(async () => {
        const data = await dashboard.get<{
          notes: EntityRef[];
          related: EntityRef[];
          expanded: EntityRef[];
        }>("/api/entity-links", { kind, id, date, depth });
        const line = (r: EntityRef) =>
          `- ${r.kind}:${r.id} — ${r.label}${r.href ? ` (${r.href})` : ""}`;
        const sections: string[] = [];
        if (data.notes?.length) sections.push(`Notes:\n${data.notes.map(line).join("\n")}`);
        if (data.related?.length) sections.push(`Related:\n${data.related.map(line).join("\n")}`);
        if (data.expanded?.length) {
          sections.push(`One hop further:\n${data.expanded.map(line).join("\n")}`);
        }
        return {
          content: [
            {
              type: "text",
              text:
                sections.length === 0
                  ? `Nothing linked to ${kind}:${id}`
                  : `${kind}:${id}\n\n${sections.join("\n\n")}`,
            },
          ],
        };
      }) },
    (result) => result as DashboardToolResult);
}
