import { z } from "zod";
import { ContentConflictError } from "../storage/content.ts";
import { defineAction } from "./define.ts";
import { textToBlocks } from "../markdown-convert/index.ts";
import { withPrReviewEntityLinks } from "../pr-note/index.ts";
import { isTaskNotePath } from "../task-note/sections.ts";

export interface NoteFile {
  path: string;
  content: unknown;
  modified: number;
  size: number;
  revision?: string;
}

export interface NotesReader {
  read: (path: string) => NoteFile | null;
}

export interface NotesReadResult {
  path: string;
  file: NoteFile | null;
}

export const notesReadInput = z.object({
  path: z.string().describe("Relative path (e.g. daily/2026-05-11, learnings/tools, my-scratch-note)"),
}).meta({ additionalProperties: false });

export const notesRead = defineAction<typeof notesReadInput, NotesReader, NotesReadResult>({
  input: notesReadInput,
  http: { method: "GET", path: "/api/notes/[...path]", discriminator: "path does not start with diagrams/" },
  mcp: { name: "notes_read", toolset: "notes", description: "Read a note by its relative path (with or without .json). Returns the content as readable markdown text. Day journals: daily/YYYY-MM-DD. General scratch: root filenames like index." },
  handler: ({ path }, storage) => ({ path, file: storage.read(path) }),
});

export interface NotesWriter extends NotesReader {
  write: (path: string, content: unknown, expectedRevision: string | null) => NoteFile | Promise<NoteFile>;
}

export type NotesWriteContext = {
  storage: NotesWriter;
} & ({ mode: "markdown" } | {
  mode: "http";
  createOnly: boolean;
  expectedModified?: number | null;
  expectedRevision?: string | null;
  mergeAgentSections?: boolean;
  merge: (stored: NoteFile, outgoing: unknown[]) => { blocks: unknown[] } | null;
});

export interface NotesWriteResult {
  path: string;
  file: NoteFile | null;
  existed: boolean;
  merged?: unknown[];
}

export const notesWriteInput = z.object({
  path: z.string().describe("Relative path for the note (e.g. 'learnings/tools')"),
  content: z.string().describe("Markdown content to write"),
  expectedRevision: z.string().nullable().optional(),
}).meta({ additionalProperties: false });

async function writeNote({ path, content, expectedRevision }: z.output<typeof notesWriteInput>, context: NotesWriteContext, createOnly = false): Promise<NotesWriteResult> {
  const { storage } = context;
  if (context.mode === "markdown") {
    const existing = storage.read(path);
    const markdown = path.replace(/^\/+/, "").startsWith("pr-reviews/") ? withPrReviewEntityLinks(content) : content;
    return { path, existed: Boolean(existing), file: await storage.write(path, textToBlocks(markdown), createOnly ? null : expectedRevision ?? null) };
  }

  let blocks: unknown = JSON.parse(content);
  let merged: unknown[] | undefined;
  const current = storage.read(path);
  const expected = expectedRevision !== undefined ? expectedRevision : context.expectedRevision;
  if (current && !context.createOnly && expected === undefined && context.expectedModified === undefined) throw new ContentConflictError(path);
  if (expected !== undefined && (current?.revision ?? null) !== expected) throw new ContentConflictError(path);
  if (context.createOnly && current) return { path, existed: true, file: null };
  if (context.expectedModified !== undefined) {
    const stale = context.expectedModified === null ? current !== null : !current || current.modified !== context.expectedModified;
    if (stale) {
      const result = context.mergeAgentSections && current && isTaskNotePath(path) && Array.isArray(blocks)
        ? context.merge(current, blocks)
        : null;
      if (!result) return { path, existed: Boolean(current), file: null };
      blocks = result.blocks;
      merged = result.blocks;
    }
  }
  return { path, existed: Boolean(current), file: await storage.write(path, blocks, context.createOnly ? null : current?.revision ?? null), merged };
}

export const notesWrite = defineAction<typeof notesWriteInput, NotesWriteContext, NotesWriteResult>({
  input: notesWriteInput,
  http: { method: "PUT", path: "/api/notes/[...path]", discriminator: "path does not start with diagrams/" },
  mcp: { name: "notes_write", toolset: "notes", description: "Create or update a note. Accepts markdown text, converts to structured format internally. Paths under pr-reviews/ auto-upsert a ## Links section with PR + repo EntityRefs (same shared/pr-note helper as notes_create_pr)." },
  handler: writeNote,
});

export const notesCreate = defineAction<typeof notesWriteInput, NotesWriteContext, NotesWriteResult>({
  input: notesWriteInput,
  http: { method: "POST", path: "/api/notes/[...path]", discriminator: "path does not start with diagrams/" },
  mcp: { reason: "The MCP notes_write tool already supports creation." },
  handler: (input, context) => writeNote(input, context, true),
});

export const notesAppendInput = z.object({
  path: z.string().describe("Relative path to the note"),
  content: z.string().describe("Markdown content to append"),
}).meta({ additionalProperties: false });

export const notesAppend = defineAction<typeof notesAppendInput, NotesWriter, NotesWriteResult>({
  input: notesAppendInput,
  http: { reason: "Appending is an MCP-only operation." },
  mcp: { name: "notes_append", toolset: "notes", description: "Append content to an existing note. Adds new blocks at the end." },
  handler: async ({ path, content }, storage) => {
    for (let attempt = 0; ; attempt++) {
      const existing = storage.read(path);
      const blocks = textToBlocks(content);
      const combined = existing ? [...((existing.content as unknown[]) || []), ...blocks] : blocks;
      try {
        return { path, existed: Boolean(existing), file: await storage.write(path, combined, existing?.revision ?? null) };
      } catch (error) {
        if (!(error instanceof ContentConflictError) || attempt !== 0) throw error;
      }
    }
  },
});

export interface NotesDeleter extends NotesReader {
  delete: (path: string, expectedRevision: string) => boolean | Promise<boolean>;
}

export interface NotesDeleteResult {
  path: string;
  deleted: boolean;
}

export const notesDeleteInput = z.object({
  path: z.string().describe("Relative path to the note to delete"),
  expectedRevision: z.string().optional(),
}).meta({ additionalProperties: false });

export const notesDelete = defineAction<typeof notesDeleteInput, NotesDeleter, NotesDeleteResult>({
  input: notesDeleteInput,
  http: { method: "DELETE", path: "/api/notes/[...path]", discriminator: "path does not start with diagrams/" },
  mcp: { name: "notes_delete", toolset: "notes", description: "Delete a note by its relative path." },
  handler: async ({ path, expectedRevision }, storage) => {
    const current = storage.read(path);
    if (!current && expectedRevision !== undefined) throw new ContentConflictError(path);
    return { path, deleted: current ? await storage.delete(path, expectedRevision ?? current.revision!) : false };
  },
});

export const notesRenameInput = z.object({
  path: z.string(),
  newPath: z.string().trim().min(1),
  dir: z.boolean(),
  expectedRevision: z.string().optional(),
});

export interface NotesRenamer extends NotesReader {
  readDirectory: (path: string) => Promise<{ revision: string } | null>;
  rename: (oldPath: string, newPath: string, expectedRevision: string) => Promise<NoteFile | null>;
  renameDir: (oldPath: string, newPath: string, expectedRevision: string) => Promise<{ path: string } | null>;
}

export const notesRename = defineAction<typeof notesRenameInput, NotesRenamer, NoteFile | { path: string } | null>({
  input: notesRenameInput,
  http: { method: "PATCH", path: "/api/notes/[...path]" },
  mcp: { reason: "The notes API renames arbitrary vault files and folders; diagrams_rename only renames diagrams in place." },
  handler: async ({ path, newPath, dir, expectedRevision }, storage) => {
    const current = dir ? await storage.readDirectory(path) : storage.read(path);
    if (!current) {
      if (expectedRevision !== undefined) throw new ContentConflictError(path);
      return null;
    }
    const revision = expectedRevision ?? current.revision!;
    return dir ? storage.renameDir(path, newPath, revision) : storage.rename(path, newPath, revision);
  },
});

interface NotesActionContext<Input> { execute: (input: Input) => unknown }

export const notesListInput = z.object({
}).meta({ additionalProperties: false });
export const notesList = defineAction<typeof notesListInput, NotesActionContext<z.output<typeof notesListInput>>, unknown>({
  input: notesListInput,
  http: { reason: "This workspace-scoped tree listing has no equivalent HTTP operation." },
  mcp: { name: "notes_list", toolset: "notes", description: "List workspace notes: dated journals under daily/ plus root-level .json files (scratch/context). For structured learnings use an explicit path with notes_read (e.g. learnings/engineering)." },
  handler: (input, context) => context.execute(input),
});

export const notesDevhubOpenInput = z.object({
        path: z.string().describe("Notes-relative path, with or without .json"),
}).meta({ additionalProperties: false });
export const notesDevhubOpen = defineAction<typeof notesDevhubOpenInput, NotesActionContext<z.output<typeof notesDevhubOpenInput>>, unknown>({
  input: notesDevhubOpenInput,
  http: { reason: "Opening a DevHub workspace tab is an MCP navigation operation." },
  mcp: { name: "notes_devhub_open", toolset: "notes", description: "Resolve an existing note to a DevHub link. Agent calls return the link without changing the user's page or focus. For non-note pages use ui_open." },
  handler: (input, context) => context.execute(input),
});

export const notesSearchInput = z.object({
        query: z.string().describe("Search text"),
}).meta({ additionalProperties: false });
export const notesSearch = defineAction<typeof notesSearchInput, NotesActionContext<z.output<typeof notesSearchInput>>, unknown>({
  input: notesSearchInput,
  http: { reason: "The HTTP search covers the full vault and supports additional modes; this headless search is workspace-scoped." },
  mcp: { name: "notes_search", toolset: "notes", description: "Search workspace notes only: root .json files and everything under daily/ (day journals). Does not search learnings/ unless you notes_read those paths directly." },
  handler: (input, context) => context.execute(input),
});

export const notesCreateMeetingInput = z.object({
        title: z.string().describe("Meeting title"),
        start: z.string().describe("ISO start datetime or YYYY-MM-DD"),
        end: z.string().describe("ISO end datetime or YYYY-MM-DD"),
        isAllDay: z.boolean().optional(),
        location: z.string().optional(),
        conferenceUrl: z.string().optional().describe("Meet/Zoom/etc URL"),
        htmlLink: z.string().optional().describe("Calendar event URL"),
        attendees: z.array(z.string()).optional(),
        overwrite: z
          .boolean()
          .optional()
          .describe("If false and note exists, leave it and return the path (default true)"),
}).meta({ additionalProperties: false });
export const notesCreateMeeting = defineAction<typeof notesCreateMeetingInput, NotesActionContext<z.output<typeof notesCreateMeetingInput>>, unknown>({
  input: notesCreateMeetingInput,
  http: { reason: "The HTTP note creation route accepts blocks and does not create a meeting scaffold or use this overwrite policy." },
  mcp: { name: "notes_create_meeting", toolset: "notes", description: "Create a meeting note under meetings/YYYY-MM-DD-<slug> with agenda/notes/action-items scaffold and a ## Links backref to the calendar event (same EntityRef contract as the Today/calendar UI button). Overwrites if the path already exists unless overwrite is false." },
  handler: (input, context) => context.execute(input),
});

export const notesCreateTaskInput = z.object({
        id: z.string().describe("Task id"),
        text: z.string().describe("Task text / note title"),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Task day date YYYY-MM-DD"),
        jiraKey: z.string().optional(),
        jiraUrl: z.string().optional().describe("Absolute Jira browse URL"),
        overwrite: z
          .boolean()
          .optional()
          .describe("If true, rewrite the note even when it already exists (default false)"),
}).meta({ additionalProperties: false });
export const notesCreateTask = defineAction<typeof notesCreateTaskInput, NotesActionContext<z.output<typeof notesCreateTaskInput>>, unknown>({
  input: notesCreateTaskInput,
  http: { reason: "The HTTP note creation route accepts blocks and does not resolve task lineage or use this overwrite policy." },
  mcp: { name: "notes_create_task", toolset: "notes", description: "Open or create the task's canonical note, following earlier daily copies when needed. Includes a ## Links section (live ::task-ref + Work href). Leaves an existing note alone unless overwrite is true." },
  handler: (input, context) => context.execute(input),
});

export const notesCreatePrInput = z.object({
        repo: z.string().describe("owner/repo"),
        number: z.number().int().positive(),
        title: z.string(),
        url: z.string().describe("GitHub PR URL"),
        overwrite: z.boolean().optional(),
}).meta({ additionalProperties: false });
export const notesCreatePr = defineAction<typeof notesCreatePrInput, NotesActionContext<z.output<typeof notesCreatePrInput>>, unknown>({
  input: notesCreatePrInput,
  http: { reason: "The HTTP note creation route accepts blocks and does not create a PR scaffold or use this overwrite policy." },
  mcp: { name: "notes_create_pr", toolset: "notes", description: "Create a PR review note under pr-reviews/<repo>-<n> with ## Links EntityRefs back to the PR and its repo (same contract as the PR row FileText action). Leaves an existing note alone unless overwrite is true." },
  handler: (input, context) => context.execute(input),
});

export const notesIndexInput = z.object({ recent: z.boolean() });
export const notesIndex = defineAction<typeof notesIndexInput, NotesActionContext<z.output<typeof notesIndexInput>>, unknown>({
  input: notesIndexInput,
  http: { method: "GET", path: "/api/notes-index" },
  mcp: { reason: "The editor index returns all vault slugs or recent summaries; notes_list exposes a workspace-scoped tree." },
  handler: (input, context) => context.execute(input),
});

export const noteOrderInput = z.object({
  vault: z.enum(["notes", "docs"]),
  paths: z.array(z.string().min(1)).min(1),
});
export const noteOrder = defineAction<typeof noteOrderInput, NotesActionContext<z.output<typeof noteOrderInput>>, unknown>({
  input: noteOrderInput,
  http: { method: "PATCH", path: "/api/note-order" },
  mcp: { reason: "Ordering vault entries is a dashboard navigation preference." },
  handler: (input, context) => context.execute(input),
});

export const notesAiChatInput = z.object({ body: z.unknown() });
export const notesAiChat = defineAction<typeof notesAiChatInput, NotesActionContext<z.output<typeof notesAiChatInput>>, unknown>({
  input: notesAiChatInput,
  http: { method: "POST", path: "/api/notes/ai/chat" },
  mcp: { reason: "BlockNote editor chat streams its UI messages and tools to the browser." },
  handler: (input, context) => context.execute(input),
});

export const notesAiStatusInput = z.object({});
export const notesAiStatus = defineAction<typeof notesAiStatusInput, NotesActionContext<z.output<typeof notesAiStatusInput>>, unknown>({
  input: notesAiStatusInput,
  http: { method: "GET", path: "/api/notes/ai/status" },
  mcp: { reason: "AI configuration status is used by the notes editor." },
  handler: (input, context) => context.execute(input),
});

export const notesPlanLoadInput = z.object({
  notePath: z.string().nullable(),
  parentKey: z.string().nullable(),
  projectKey: z.string().nullable(),
  epicSummary: z.string().nullable(),
  repos: z.array(z.string()),
});
export const notesPlanLoad = defineAction<typeof notesPlanLoadInput, NotesActionContext<z.output<typeof notesPlanLoadInput>>, unknown>({
  input: notesPlanLoadInput,
  http: { method: "GET", path: "/api/notes/create-tasks/plan" },
  mcp: { reason: "The task creation wizard loads note and Jira context for interactive planning." },
  handler: (input, context) => context.execute(input),
});

export const notesPlanPreviewInput = z.object({
  notePath: z.string().trim().min(1).max(1_000),
  refineTitles: z.boolean().default(false),
  provider: z.enum(["cursor-cli", "chatgpt-cli", "antigravity-cli", "opencode", "api"]).optional(),
  model: z.string().trim().max(256).refine((value) => !/[\r\n\0]/.test(value)).optional(),
  effort: z.string().trim().regex(/^[A-Za-z0-9_-]{0,32}$/).optional(),
});
export const notesPlanPreview = defineAction<typeof notesPlanPreviewInput, NotesActionContext<z.output<typeof notesPlanPreviewInput>>, unknown>({
  input: notesPlanPreviewInput,
  http: { method: "POST", path: "/api/notes/create-tasks/plan" },
  mcp: { reason: "The task creation wizard previews and optionally refines titles before launch." },
  handler: (input, context) => context.execute(input),
});
