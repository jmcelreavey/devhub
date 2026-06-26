import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";

export function registerTasksTools(server: McpServer, ctx: Context): void {
  const { tasksStorage } = ctx;

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
        content: [
          {
            type: "text",
            text: `Tasks for ${target} (${day.completed}/${day.total} done, ${day.abandoned} abandoned, ${day.moved} moved):\n${lines.join("\n")}`,
          },
        ],
      };
    },
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
      return { content: [{ type: "text", text: `Created task: ${task.id} — ${task.text}` }] };
    },
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
        status: z
          .enum(["complete", "abandon", "reactivate"])
          .optional()
          .describe("Status change: complete, abandon, or reactivate"),
        abandonReason: z.string().optional().describe("Reason for abandoning"),
        date: z.string().optional().describe("Date the task belongs to (YYYY-MM-DD). Defaults to today."),
      },
    },
    async ({ id, text, done, due, status, abandonReason, date }) => {
      const task = tasksStorage.update(id, { text, done, due, status, abandonReason }, date);
      if (!task) {
        return { content: [{ type: "text", text: `Task not found: ${id}` }] };
      }
      return { content: [{ type: "text", text: `Updated task: ${task.id} — ${task.text} (done=${task.done})` }] };
    },
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
      return { content: [{ type: "text", text: deleted ? `Deleted task: ${id}` : `Task not found: ${id}` }] };
    },
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
            content: [
              {
                type: "text",
                text: `${date}: ${day.total} tasks, ${day.completed} done, ${day.abandoned} abandoned, ${day.moved} moved`,
              },
            ],
          };
        }
        const lines = day.tasks.map((t) => {
          const s = t.done ? "x" : t.movedAt ? ">" : t.abandonedAt ? "~" : " ";
          return `- [${s}] ${t.text}`;
        });
        return {
          content: [{ type: "text", text: `${date} (${day.completed}/${day.total} done):\n${lines.join("\n")}` }],
        };
      }
      const days = tasksStorage.list();
      if (days.length === 0) {
        return { content: [{ type: "text", text: "No task history" }] };
      }
      const lines = days.map(
        (d) => `${d.date}: ${d.total} tasks, ${d.completed} done, ${d.abandoned} abandoned, ${d.moved} moved`,
      );
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
}
