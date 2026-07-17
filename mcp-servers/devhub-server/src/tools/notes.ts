import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import type { TreeEntry } from "../storage.ts";
import { flattenTree } from "../shared.ts";
import { blocksToText, textToBlocks } from "../convert.ts";
import {
  buildMeetingNoteMarkdown,
  meetingNotePath,
  type MeetingNoteEvent,
} from "../../../../shared/meeting-note/index.ts";

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
  const { storage, notesDir } = ctx;

  server.registerTool(
    "notes_list",
    {
      description:
        "List workspace notes: dated journals under daily/ plus root-level .json files (scratch/context). For structured learnings use an explicit path with notes_read (e.g. learnings/engineering).",
    },
    async () => {
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
    },
  );

  server.registerTool(
    "notes_read",
    {
      description:
        "Read a note by its relative path (with or without .json). Returns the content as readable markdown text. Day journals: daily/YYYY-MM-DD. General scratch: root filenames like index.",
      inputSchema: {
        path: z.string().describe("Relative path (e.g. daily/2026-05-11, learnings/tools, my-scratch-note)"),
      },
    },
    async ({ path: filePath }) => {
      const note = storage.read(filePath);
      if (!note) {
        return { content: [{ type: "text", text: `Note not found: ${filePath}` }] };
      }
      const blocks = note.content as unknown[];
      const text = blocksToText(Array.isArray(blocks) ? blocks : [blocks]);
      return { content: [{ type: "text", text: `# ${note.path}\n\n${text}` }] };
    },
  );

  server.registerTool(
    "notes_write",
    {
      description: "Create or update a note. Accepts markdown text, converts to structured format internally.",
      inputSchema: {
        path: z.string().describe("Relative path for the note (e.g. 'learnings/tools')"),
        content: z.string().describe("Markdown content to write"),
      },
    },
    async ({ path: filePath, content }) => {
      const existing = storage.read(filePath);
      const blocks = textToBlocks(content);
      storage.write(filePath, blocks);
      const action = existing ? "Updated" : "Created";
      return { content: [{ type: "text", text: `${action}: ${filePath}` }] };
    },
  );

  server.registerTool(
    "notes_write_asset",
    {
      description:
        "Write a binary image asset under the notes tree (e.g. garden/my-project/assets/photo-1.jpg). Use before notes_write when embedding photos via ![caption](path) markdown.",
      inputSchema: {
        path: z
          .string()
          .describe("Notes-relative asset path (must not end in .json). Allowed: jpg, jpeg, png, gif, webp"),
        contentBase64: z.string().describe("Base64-encoded file bytes"),
        mimeType: z.string().optional().describe("Optional MIME hint (ignored if extension is valid)"),
      },
    },
    async ({ path: assetPath, contentBase64 }) => {
      let data: Buffer;
      try {
        data = Buffer.from(contentBase64, "base64");
      } catch {
        return { content: [{ type: "text", text: "Invalid base64 content" }], isError: true };
      }
      if (data.length === 0) {
        return { content: [{ type: "text", text: "Empty asset content" }], isError: true };
      }
      try {
        const result = storage.writeAsset(assetPath, data);
        return {
          content: [
            {
              type: "text",
              text: `Wrote asset: ${result.path} (${result.size} bytes). Reference in markdown as ![caption](${result.path})`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not write asset";
        return { content: [{ type: "text", text: message }], isError: true };
      }
    },
  );

  server.registerTool(
    "notes_append",
    {
      description: "Append content to an existing note. Adds new blocks at the end.",
      inputSchema: {
        path: z.string().describe("Relative path to the note"),
        content: z.string().describe("Markdown content to append"),
      },
    },
    async ({ path: filePath, content }) => {
      const existing = storage.read(filePath);
      if (!existing) {
        const blocks = textToBlocks(content);
        storage.write(filePath, blocks);
        return { content: [{ type: "text", text: `Created (was new): ${filePath}` }] };
      }
      const currentBlocks = (existing.content as unknown[]) || [];
      const newBlocks = textToBlocks(content);
      storage.write(filePath, [...currentBlocks, ...newBlocks]);
      return { content: [{ type: "text", text: `Appended to: ${filePath}` }] };
    },
  );

  server.registerTool(
    "notes_search",
    {
      description:
        "Search workspace notes only: root .json files and everything under daily/ (day journals). Does not search learnings/ unless you notes_read those paths directly.",
      inputSchema: {
        query: z.string().describe("Search text"),
      },
    },
    async ({ query }) => {
      const results = storage.search(query);
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
    },
  );

  server.registerTool(
    "notes_delete",
    {
      description: "Delete a note by its relative path.",
      inputSchema: {
        path: z.string().describe("Relative path to the note to delete"),
      },
    },
    async ({ path: filePath }) => {
      const deleted = storage.delete(filePath);
      if (!deleted) {
        return { content: [{ type: "text", text: `Not found: ${filePath}` }] };
      }
      return { content: [{ type: "text", text: `Deleted: ${filePath}` }] };
    },
  );

  server.registerTool(
    "notes_create_meeting",
    {
      description:
        "Create a meeting note under meetings/YYYY-MM-DD-<slug> with agenda/notes/action-items scaffold (same as the Today strip button). Overwrites if the path already exists unless overwrite is false.",
      inputSchema: {
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
      },
    },
    async ({ title, start, end, isAllDay, location, conferenceUrl, htmlLink, attendees, overwrite }) => {
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
      const existing = storage.read(path);
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
      storage.write(path, textToBlocks(markdown));
      return {
        content: [
          {
            type: "text",
            text: `${existing ? "Updated" : "Created"}: ${path}\n\n${markdown}`,
          },
        ],
      };
    },
  );
}
