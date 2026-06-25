import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "node:path";
import { NotesStorage, type TreeEntry } from "./storage.ts";
import {
  VaultStorage,
  flattenTree,
  markdownVaultCodec,
  resolveContentDir,
} from "../../../shared/vault/index.ts";
import { blocksToText, textToBlocks } from "./convert.ts";
import { TasksStorage, DiagramsStorage } from "./task-diagram-storage.ts";
import * as appraisal from "./appraisal.ts";

const REPO_ROOT = process.env.REPO_ROOT || path.resolve(process.cwd(), "../..");
const NOTES_DIR = process.env.NOTES_DIR || path.resolve(process.cwd(), "notes");
const TASKS_DIR = process.env.TASKS_DIR || path.resolve(process.cwd(), "tasks");
const DOCS_DIR = resolveContentDir("DOCS_DIR", REPO_ROOT, "docs");
const storage = new NotesStorage(NOTES_DIR);
const docsStorage = new VaultStorage(DOCS_DIR, markdownVaultCodec);
const tasksStorage = new TasksStorage(TASKS_DIR);
const diagramsStorage = new DiagramsStorage(storage);

function filterAgentNoteTree(entries: TreeEntry[]): TreeEntry[] {
  const daily = entries.find((e) => e.type === "dir" && e.name === "daily");
  const rootJson = entries.filter((e) => e.type === "file" && e.name.endsWith(".json"));
  const out: TreeEntry[] = [];
  if (daily) out.push(daily);
  out.push(...rootJson);
  return out;
}

const server = new McpServer({
  name: "devhub",
  version: "3.0.0",
});

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
          text: lines.length > 0
            ? `Notes in ${NOTES_DIR}:\n${lines.join("\n")}`
            : "No notes found",
        },
      ],
    };
  }
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
      return {
        content: [{ type: "text", text: `Note not found: ${filePath}` }],
      };
    }
    const blocks = note.content as unknown[];
    const text = blocksToText(Array.isArray(blocks) ? blocks : [blocks]);
    return {
      content: [{ type: "text", text: `# ${note.path}\n\n${text}` }],
    };
  }
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
    return {
      content: [{ type: "text", text: `${action}: ${filePath}` }],
    };
  }
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
      return {
        content: [{ type: "text", text: "Invalid base64 content" }],
        isError: true,
      };
    }
    if (data.length === 0) {
      return {
        content: [{ type: "text", text: "Empty asset content" }],
        isError: true,
      };
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
      return {
        content: [{ type: "text", text: message }],
        isError: true,
      };
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
      return {
        content: [{ type: "text", text: `Created (was new): ${filePath}` }],
      };
    }
    const currentBlocks = (existing.content as unknown[]) || [];
    const newBlocks = textToBlocks(content);
    storage.write(filePath, [...currentBlocks, ...newBlocks]);
    return {
      content: [{ type: "text", text: `Appended to: ${filePath}` }],
    };
  }
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
      return {
        content: [{ type: "text", text: `No results for "${query}"` }],
      };
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
  }
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
      return {
        content: [{ type: "text", text: `Not found: ${filePath}` }],
      };
    }
    return {
      content: [{ type: "text", text: `Deleted: ${filePath}` }],
    };
  }
);

// ── Docs tools ─────────────────────────────────────────────────────

server.registerTool(
  "docs_list",
  {
    description: "List all repo docs under DOCS_DIR (Markdown .md files).",
  },
  async () => {
    const lines = flattenTree(docsStorage.list());
    return {
      content: [
        {
          type: "text",
          text: lines.length > 0
            ? `Docs in ${DOCS_DIR}:\n${lines.join("\n")}`
            : "No docs found",
        },
      ],
    };
  },
);

server.registerTool(
  "docs_read",
  {
    description:
      "Read a doc by relative path (with or without .md). Returns raw markdown.",
    inputSchema: {
      path: z.string().describe("Relative path (e.g. architecture/notes-system, SUMMARY)"),
    },
  },
  async ({ path: filePath }) => {
    const doc = docsStorage.read(filePath);
    if (!doc) {
      return {
        content: [{ type: "text", text: `Doc not found: ${filePath}` }],
      };
    }
    const displayPath = doc.path.replace(/\.md$/i, "");
    return {
      content: [{ type: "text", text: `# ${displayPath}\n\n${doc.content}` }],
    };
  },
);

server.registerTool(
  "docs_write",
  {
    description: "Create or update a doc. Accepts markdown text.",
    inputSchema: {
      path: z.string().describe("Relative path for the doc (e.g. guides/skills)"),
      content: z.string().describe("Markdown content to write"),
    },
  },
  async ({ path: filePath, content }) => {
    const existing = docsStorage.read(filePath);
    docsStorage.write(filePath, content);
    const action = existing ? "Updated" : "Created";
    return {
      content: [{ type: "text", text: `${action}: ${filePath}` }],
    };
  },
);

server.registerTool(
  "docs_append",
  {
    description: "Append markdown to an existing doc (or create it if missing).",
    inputSchema: {
      path: z.string().describe("Relative path to the doc"),
      content: z.string().describe("Markdown content to append"),
    },
  },
  async ({ path: filePath, content }) => {
    const existing = docsStorage.read(filePath);
    const combined = existing
      ? `${String(existing.content)}${content}`
      : content;
    docsStorage.write(filePath, combined);
    const action = existing ? "Appended to" : "Created";
    return {
      content: [{ type: "text", text: `${action}: ${filePath}` }],
    };
  },
);

server.registerTool(
  "docs_search",
  {
    description: "Search all docs under DOCS_DIR for matching text.",
    inputSchema: {
      query: z.string().describe("Search text"),
    },
  },
  async ({ query }) => {
    const results = docsStorage.searchText(query);
    if (results.length === 0) {
      return {
        content: [{ type: "text", text: `No results for "${query}"` }],
      };
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
  "docs_delete",
  {
    description: "Delete a doc by its relative path.",
    inputSchema: {
      path: z.string().describe("Relative path to the doc to delete"),
    },
  },
  async ({ path: filePath }) => {
    const deleted = docsStorage.delete(filePath);
    if (!deleted) {
      return {
        content: [{ type: "text", text: `Not found: ${filePath}` }],
      };
    }
    return {
      content: [{ type: "text", text: `Deleted: ${filePath}` }],
    };
  },
);

// ── Task tools ──────────────────────────────────────────────────────

server.registerTool(
  "tasks_list",
  {
    description: "List today's tasks. Returns all tasks for today with their status (done/abandoned/active).",
    inputSchema: {
      date: z.string().optional().describe("Date in YYYY-MM-DD format. Defaults to today."),
    },
  },
  async ({ date }) => {
    const target = date || new Date().toISOString().split("T")[0];
    const day = tasksStorage.getDay(target);
    if (day.tasks.length === 0) {
      return { content: [{ type: "text", text: `No tasks for ${target}` }] };
    }
    const lines = day.tasks.map((t) => {
      const status = t.done ? "x" : t.movedAt ? ">" : t.abandonedAt ? "~" : " ";
      const due = t.due ? ` (due ${t.due})` : "";
      const jira = t.jiraKey ? ` [${t.jiraKey}]` : "";
      return `- [${status}] ${t.text}${jira}${due}`;
    });
    return {
      content: [{
        type: "text",
        text: `Tasks for ${target} (${day.completed}/${day.total} done, ${day.abandoned} abandoned, ${day.moved} moved):\n${lines.join("\n")}`,
      }],
    };
  }
);

server.registerTool(
  "tasks_create",
  {
    description: "Create a new task. Auto-extracts Jira keys from text (e.g. DAD-1234).",
    inputSchema: {
      text: z.string().describe("Task description (1-500 chars). Jira keys like DAD-1234 are auto-detected."),
      date: z.string().optional().describe("Date in YYYY-MM-DD format. Defaults to today."),
      due: z.string().optional().describe("Due date in YYYY-MM-DD format."),
    },
  },
  async ({ text, date, due }) => {
    const task = tasksStorage.add(text, date, due);
    return {
      content: [{ type: "text", text: `Created task: ${task.id} — ${task.text}` }],
    };
  }
);

server.registerTool(
  "tasks_update",
  {
    description: "Update a task: toggle done, edit text, set due date, abandon, or reactivate.",
    inputSchema: {
      id: z.string().describe("Task ID (UUID)"),
      text: z.string().optional().describe("New task text"),
      done: z.boolean().optional().describe("Set done status directly"),
      due: z.string().nullable().optional().describe("Due date (YYYY-MM-DD) or null to clear"),
      status: z.enum(["complete", "abandon", "reactivate"]).optional().describe("Status change: complete, abandon, or reactivate"),
      abandonReason: z.string().optional().describe("Reason for abandoning"),
      date: z.string().optional().describe("Date the task belongs to (YYYY-MM-DD). Defaults to today."),
    },
  },
  async ({ id, text, done, due, status, abandonReason, date }) => {
    const task = tasksStorage.update(id, { text, done, due, status, abandonReason }, date);
    if (!task) {
      return { content: [{ type: "text", text: `Task not found: ${id}` }] };
    }
    return {
      content: [{ type: "text", text: `Updated task: ${task.id} — ${task.text} (done=${task.done})` }],
    };
  }
);

server.registerTool(
  "tasks_delete",
  {
    description: "Delete a task permanently.",
    inputSchema: {
      id: z.string().describe("Task ID (UUID)"),
      date: z.string().optional().describe("Date the task belongs to (YYYY-MM-DD). Defaults to today."),
    },
  },
  async ({ id, date }) => {
    const deleted = tasksStorage.delete(id, date);
    return {
      content: [{ type: "text", text: deleted ? `Deleted task: ${id}` : `Task not found: ${id}` }],
    };
  }
);

server.registerTool(
  "tasks_history",
  {
    description:
      "List task history across all days. Returns summaries (date, total, completed, abandoned) or full task lists.",
    inputSchema: {
      includeTasks: z.boolean().optional().describe("Include full task details (default: summaries only)"),
      date: z.string().optional().describe("Filter to a specific date (YYYY-MM-DD)"),
    },
  },
  async ({ includeTasks, date }) => {
    if (date) {
      const day = tasksStorage.getDay(date);
      if (day.tasks.length === 0) {
        return { content: [{ type: "text", text: `No tasks for ${date}` }] };
      }
      if (!includeTasks) {
        return {
          content: [{
            type: "text",
            text: `${date}: ${day.total} tasks, ${day.completed} done, ${day.abandoned} abandoned, ${day.moved} moved`,
          }],
        };
      }
      const lines = day.tasks.map((t) => {
        const s = t.done ? "x" : t.movedAt ? ">" : t.abandonedAt ? "~" : " ";
        return `- [${s}] ${t.text}`;
      });
      return {
        content: [{
          type: "text",
          text: `${date} (${day.completed}/${day.total} done):\n${lines.join("\n")}`,
        }],
      };
    }
    const days = tasksStorage.list();
    if (days.length === 0) {
      return { content: [{ type: "text", text: "No task history" }] };
    }
    const lines = days.map((d) => `${d.date}: ${d.total} tasks, ${d.completed} done, ${d.abandoned} abandoned, ${d.moved} moved`);
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// ── Diagram tools ──────────────────────────────────────────────────

server.registerTool(
  "diagrams_list",
  {
    description: "List all diagrams. Returns names, paths, and last modified dates.",
  },
  async () => {
    const diagrams = diagramsStorage.list();
    if (diagrams.length === 0) {
      return { content: [{ type: "text", text: "No diagrams found" }] };
    }
    const lines = diagrams.map((d) => `${d.path} (modified: ${new Date(d.modified).toISOString().split("T")[0]})`);
    return { content: [{ type: "text", text: `Diagrams:\n${lines.join("\n")}` }] };
  }
);

server.registerTool(
  "diagrams_read",
  {
    description: "Read a diagram's raw tldraw JSON data. Returns the full JSON content.",
    inputSchema: {
      path: z.string().describe("Diagram path (e.g. 'diagrams/2026-05-13-diagram')"),
    },
  },
  async ({ path: diagramPath }) => {
    const data = diagramsStorage.read(diagramPath);
    if (!data) {
      return { content: [{ type: "text", text: `Diagram not found: ${diagramPath}` }] };
    }
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.registerTool(
  "diagrams_create",
  {
    description: "Create a new empty tldraw diagram. Use a slash in the name to place it in a folder (folders are created automatically).",
    inputSchema: {
      name: z
        .string()
        .optional()
        .describe(
          "Custom name for the diagram, auto-generated if omitted. May include a folder path, e.g. 'Acme/Reports/matching'.",
        ),
    },
  },
  async ({ name }) => {
    const result = diagramsStorage.create(name);
    return {
      content: [{ type: "text", text: `Created diagram: ${result.path}` }],
    };
  }
);

server.registerTool(
  "diagrams_update",
  {
    description: "Update a diagram with new tldraw JSON data.",
    inputSchema: {
      path: z.string().describe("Diagram path"),
      data: z.string().describe("tldraw JSON data as a string"),
    },
  },
  async ({ path: diagramPath, data }) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return { content: [{ type: "text", text: "Invalid JSON data" }] };
    }
    const ok = diagramsStorage.update(diagramPath, parsed);
    return {
      content: [{ type: "text", text: ok ? `Updated: ${diagramPath}` : `Diagram not found: ${diagramPath}` }],
    };
  }
);

server.registerTool(
  "diagrams_add_note",
  {
    description:
      "Add a sticky note shape to a diagram. Use when the user asks to add a note, comment, TODO, or reminder to a diagram.",
    inputSchema: {
      path: z.string().describe("Diagram path"),
      text: z.string().describe("Note text. Use newlines for separate note lines."),
      x: z.number().optional().describe("Optional x coordinate"),
      y: z.number().optional().describe("Optional y coordinate"),
      color: z.string().optional().describe("Optional tldraw note color, defaults to yellow"),
    },
  },
  async ({ path: diagramPath, text, x, y, color }) => {
    const result = diagramsStorage.addNote(diagramPath, { text, x, y, color });
    if (!result) {
      return { content: [{ type: "text", text: `Diagram not found: ${diagramPath}` }] };
    }
    return {
      content: [{ type: "text", text: `Added note ${result.shapeId} to ${result.path}` }],
    };
  }
);

server.registerTool(
  "diagrams_delete",
  {
    description: "Delete a diagram.",
    inputSchema: {
      path: z.string().describe("Diagram path to delete"),
    },
  },
  async ({ path: diagramPath }) => {
    const ok = diagramsStorage.delete(diagramPath);
    return {
      content: [{ type: "text", text: ok ? `Deleted: ${diagramPath}` : `Diagram not found: ${diagramPath}` }],
    };
  }
);

server.registerTool(
  "diagrams_rename",
  {
    description: "Rename a diagram in place, keeping it in its current folder.",
    inputSchema: {
      path: z.string().describe("Current diagram path, e.g. 'diagrams/Acme/Reports/matching'"),
      newName: z.string().describe("New base name only (no folder path); the diagram stays in its current folder"),
    },
  },
  async ({ path: diagramPath, newName }) => {
    const newPath = diagramsStorage.rename(diagramPath, newName);
    if (!newPath) {
      return { content: [{ type: "text", text: `Diagram not found: ${diagramPath}` }] };
    }
    return {
      content: [{ type: "text", text: `Renamed to: ${newPath}` }],
    };
  }
);

// ── Self-appraisal tools ───────────────────────────────────────────

/** Read a subject/year appraisal note as markdown, or a fresh skeleton if absent. */
function readAppraisalMd(subject: string | undefined, year: string): { path: string; md: string; exists: boolean } {
  const filePath = appraisal.subjectYearPath(subject, year);
  const note = storage.read(filePath);
  if (!note) {
    return { path: filePath, md: appraisal.skeleton(subject, year), exists: false };
  }
  const blocks = note.content as unknown[];
  return { path: filePath, md: blocksToText(Array.isArray(blocks) ? blocks : [blocks]), exists: true };
}

function writeAppraisalMd(filePath: string, md: string): void {
  storage.write(filePath, textToBlocks(md));
}

server.registerTool(
  "appraisal_record",
  {
    description:
      "Record a noteworthy moment for performance review. Creates/updates a per-year note under appraisal/, organised by theme. Dedups by slug (update in place). Use for your own self-appraisal (subject defaults to 'self') or for someone you appraise (subject = their name).",
    inputSchema: {
      subject: z.string().optional().describe("'self' (default) or a person name/slug you appraise"),
      title: z.string().describe("Short entry title, e.g. 'Cut CI pipeline time 22→9 min'"),
      theme: z.enum(appraisal.THEMES).describe("impact | technical | collaboration | growth"),
      summary: z.string().describe("1-3 factual sentences: what happened + impact/evidence"),
      references: z.array(z.string()).min(1).describe("URLs or refs (PR, ticket, dashboard, thread). At least one required."),
      goal: z.string().optional().describe("Slug of a goal this advances (see appraisal_set_goal)"),
      tags: z.array(z.string()).optional().describe("Competency tags, e.g. ['leadership','mentoring']"),
      date: z.string().optional().describe("YYYY-MM-DD. Defaults to today; also selects the year file."),
      id: z.string().optional().describe("Explicit dedup slug. Defaults to a slug of the title."),
    },
  },
  async ({ subject, title, theme, summary, references, goal, tags, date, id }) => {
    const year = appraisal.yearOf(date);
    const { path: filePath, md } = readAppraisalMd(subject, year);

    if (goal && !appraisal.goalSlugs(md).includes(goal)) {
      const valid = appraisal.goalSlugs(md);
      return {
        content: [{
          type: "text",
          text: `Unknown goal "${goal}" for ${subject ?? "self"} ${year}. Valid goals: ${valid.length ? valid.join(", ") : "(none — create one with appraisal_set_goal)"}.`,
        }],
        isError: true,
      };
    }

    const result = appraisal.upsertEntry(md, { title, theme, summary, references, goal, tags, date, id });
    writeAppraisalMd(filePath, result.md);

    const warn = appraisal.summaryWarning(summary);
    const action = result.created ? "Recorded" : "Updated";
    return {
      content: [{
        type: "text",
        text: `${action} appraisal entry "${result.slug}" under ${appraisal.THEME_LABELS[theme]} in ${filePath}.${warn ? ` ⚠ ${warn}` : ""}`,
      }],
    };
  }
);

server.registerTool(
  "appraisal_set_goal",
  {
    description:
      "Create or revise a review goal/objective for a subject. Goals are mutable — call again with the same title/id to change status or append a dated revision (history preserved). Status: active | revised | dropped | achieved.",
    inputSchema: {
      subject: z.string().optional().describe("'self' (default) or a person name/slug"),
      title: z.string().describe("Goal title, e.g. 'Ship the new matching pipeline to GA'"),
      detail: z.string().optional().describe("What success looks like; 1-2 sentences"),
      status: z.enum(appraisal.GOAL_STATUSES).optional().describe("Default 'active'"),
      revision: z.string().optional().describe("What changed; appended as a dated 'Revised:' line"),
      year: z.string().optional().describe("YYYY. Defaults to current year."),
      id: z.string().optional().describe("Explicit goal slug. Defaults to a slug of the title."),
    },
  },
  async ({ subject, title, detail, status, revision, year, id }) => {
    const yr = appraisal.yearOf(year);
    const { path: filePath, md } = readAppraisalMd(subject, yr);
    const result = appraisal.upsertGoal(md, { title, detail, status, revision, id });
    writeAppraisalMd(filePath, result.md);
    return {
      content: [{
        type: "text",
        text: `${result.created ? "Created" : "Updated"} goal "${result.slug}" in ${filePath}. Link moments to it via appraisal_record(goal: "${result.slug}").`,
      }],
    };
  }
);

server.registerTool(
  "appraisal_list_goals",
  {
    description: "List review goals for a subject/year with status and revision history.",
    inputSchema: {
      subject: z.string().optional(),
      year: z.string().optional().describe("YYYY. Defaults to current year."),
      status: z.enum(appraisal.GOAL_STATUSES).optional().describe("Filter by status"),
    },
  },
  async ({ subject, year, status }) => {
    const yr = appraisal.yearOf(year);
    const { md, exists } = readAppraisalMd(subject, yr);
    let goals = appraisal.parseGoals(md);
    if (status) goals = goals.filter((g) => g.status === status);
    if (!exists || goals.length === 0) {
      return { content: [{ type: "text", text: `No goals for ${subject ?? "self"} ${yr}${status ? ` (status=${status})` : ""}.` }] };
    }
    const lines = goals.map((g) => {
      const revs = g.revisions.length ? `\n    ${g.revisions.join("\n    ")}` : "";
      return `- [${g.status}] ${g.title} (${g.slug}) · set ${g.set} · updated ${g.updated}${g.detail ? `\n    ${g.detail}` : ""}${revs}`;
    });
    return { content: [{ type: "text", text: `Goals for ${subject ?? "self"} ${yr}:\n${lines.join("\n")}` }] };
  }
);

server.registerTool(
  "appraisal_read",
  {
    description:
      "Read a subject's appraisal note (goals + entries) as markdown. Optionally filter entries by theme, tag, or linked goal.",
    inputSchema: {
      subject: z.string().optional().describe("'self' (default) or a person name/slug"),
      year: z.string().optional().describe("YYYY. Defaults to current year."),
      theme: z.enum(appraisal.THEMES).optional(),
      tag: z.string().optional().describe("Filter to entries carrying this tag"),
      goal: z.string().optional().describe("Filter to entries linked to this goal slug"),
    },
  },
  async ({ subject, year, theme, tag, goal }) => {
    const yr = appraisal.yearOf(year);
    const { md, exists } = readAppraisalMd(subject, yr);
    if (!exists) {
      return { content: [{ type: "text", text: `No appraisal note for ${subject ?? "self"} ${yr} yet. Skeleton:\n\n${md}` }] };
    }
    if (!theme && !tag && !goal) {
      return { content: [{ type: "text", text: md }] };
    }
    const wantTag = tag ? (tag.startsWith("#") ? tag : `#${tag}`) : undefined;
    const entries = appraisal.parseEntries(md).filter((e) =>
      (!theme || e.theme === theme) &&
      (!wantTag || e.tags.includes(wantTag)) &&
      (!goal || e.goal === goal)
    );
    if (entries.length === 0) {
      return { content: [{ type: "text", text: `No matching entries for ${subject ?? "self"} ${yr}.` }] };
    }
    const lines = entries.map((e) =>
      `### ${e.title} [${appraisal.THEME_LABELS[e.theme]}]\n${e.date} — ${e.body}${e.goal ? `\nGoal: ${e.goal}` : ""}${e.tags.length ? `\nTags: ${e.tags.join(" ")}` : ""}`
    );
    return { content: [{ type: "text", text: lines.join("\n\n") }] };
  }
);

server.registerTool(
  "appraisal_list",
  {
    description: "List all appraisal year files (self and people) with entry/goal counts.",
  },
  async () => {
    const files = storage.getAllNoteFiles().filter((f) => f.startsWith("appraisal/"));
    if (files.length === 0) {
      return { content: [{ type: "text", text: "No appraisal notes yet." }] };
    }
    const lines = files.map((f) => {
      const rel = f.replace(/\.json$/, "");
      const note = storage.read(rel);
      const blocks = (note?.content as unknown[]) ?? [];
      const md = blocksToText(Array.isArray(blocks) ? blocks : [blocks]);
      return `- ${rel} — ${appraisal.parseEntries(md).length} entries, ${appraisal.goalSlugs(md).length} goals`;
    });
    return { content: [{ type: "text", text: `Appraisal notes:\n${lines.join("\n")}` }] };
  }
);

server.registerTool(
  "appraisal_people",
  {
    description: "List the people you have appraisal notes for (slugs + years).",
  },
  async () => {
    const files = storage.getAllNoteFiles().filter((f) => f.startsWith("appraisal/people/"));
    if (files.length === 0) {
      return { content: [{ type: "text", text: "No people appraisal notes yet. Create one with appraisal_record(subject: 'Their Name', ...)." }] };
    }
    const byPerson: Record<string, string[]> = {};
    for (const f of files) {
      const m = f.match(/^appraisal\/people\/([^/]+)\/(\d{4})\.json$/);
      if (!m) continue;
      (byPerson[m[1]] ??= []).push(m[2]);
    }
    const lines = Object.entries(byPerson).map(([slug, years]) => `- ${slug}: ${years.sort().join(", ")}`);
    return { content: [{ type: "text", text: `People with appraisal notes:\n${lines.join("\n")}` }] };
  }
);

server.registerTool(
  "appraisal_summarize",
  {
    description:
      "Assemble a review-ready digest of a subject's year: goals with status, then entries grouped by theme with references intact. Use at review time to draft the self-appraisal (subject 'self') or your write-up of someone you appraise. Returns structured source — does not invent un-referenced claims.",
    inputSchema: {
      subject: z.string().optional().describe("'self' (default) or a person name/slug"),
      year: z.string().optional().describe("YYYY. Defaults to current year."),
      theme: z.enum(appraisal.THEMES).optional().describe("Limit to one theme"),
    },
  },
  async ({ subject, year, theme }) => {
    const yr = appraisal.yearOf(year);
    const { md, exists } = readAppraisalMd(subject, yr);
    if (!exists) {
      return { content: [{ type: "text", text: `No appraisal note for ${subject ?? "self"} ${yr} to summarize.` }] };
    }
    const goals = appraisal.parseGoals(md);
    const entries = appraisal.parseEntries(md).filter((e) => !theme || e.theme === theme);
    const out: string[] = [`# Appraisal digest — ${subject ?? "self"} ${yr}`];

    if (goals.length) {
      out.push("\n## Goals");
      for (const g of goals) out.push(`- [${g.status}] ${g.title}${g.revisions.length ? ` (${g.revisions.length} revision${g.revisions.length > 1 ? "s" : ""})` : ""}`);
    }

    for (const t of appraisal.THEMES) {
      if (theme && t !== theme) continue;
      const themed = entries.filter((e) => e.theme === t);
      if (!themed.length) continue;
      out.push(`\n## ${appraisal.THEME_LABELS[t]}`);
      for (const e of themed) {
        out.push(`- ${e.title} — ${e.date}: ${e.body}${e.goal ? ` [goal: ${e.goal}]` : ""}`);
      }
    }
    return { content: [{ type: "text", text: out.join("\n") }] };
  }
);

server.registerTool(
  "appraisal_delete",
  {
    description: "Delete a single appraisal entry by subject + year + slug. Goals are not deletable (mark them 'dropped' via appraisal_set_goal to keep history).",
    inputSchema: {
      slug: z.string().describe("Entry slug (the <!-- id: ... --> value)"),
      subject: z.string().optional().describe("'self' (default) or a person name/slug"),
      year: z.string().optional().describe("YYYY. Defaults to current year."),
    },
  },
  async ({ slug, subject, year }) => {
    const yr = appraisal.yearOf(year);
    const { path: filePath, md, exists } = readAppraisalMd(subject, yr);
    if (!exists) {
      return { content: [{ type: "text", text: `No appraisal note for ${subject ?? "self"} ${yr}.` }] };
    }
    const result = appraisal.deleteEntry(md, slug);
    if (!result.deleted) {
      return { content: [{ type: "text", text: `Entry "${slug}" not found in ${filePath}.` }] };
    }
    writeAppraisalMd(filePath, result.md);
    return { content: [{ type: "text", text: `Deleted entry "${slug}" from ${filePath}.` }] };
  }
);

// ── Server startup ─────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`DevHub MCP server running (notes: ${NOTES_DIR}, docs: ${DOCS_DIR})`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
