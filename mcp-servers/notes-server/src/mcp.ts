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
    description: "Create a new empty tldraw diagram.",
    inputSchema: {
      name: z.string().optional().describe("Custom name for the diagram (auto-generated if omitted)"),
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
    description: "Rename a diagram.",
    inputSchema: {
      path: z.string().describe("Current diagram path"),
      newName: z.string().describe("New name for the diagram (without diagrams/ prefix)"),
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
