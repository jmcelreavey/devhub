import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import { withDashboardErrors } from "../dashboard-client.ts";
import { escapeHtml, uiResult, widgetDocument } from "../ui.ts";
import { blocksToText, textToBlocks } from "../convert.ts";
import {
  buildEntityLinksSection,
  extractTags,
  parseEntityLinksFromMarkdown,
} from "../../../../shared/entity-note/index.ts";
import {
  buildTaskNoteMarkdown,
  taskEntityRefs,
  taskNotePath,
} from "../../../../shared/task-note/index.ts";

const CONTEXT_TAG_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const singleLine = (max: number) =>
  z.string().trim().min(1).max(max).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "must be one line");
const linkLabel = singleLine(500).refine((value) => !/[\[\]]/.test(value), "must not contain markdown brackets");
const linkHref = singleLine(2_000).refine((value) => !/[)]/.test(value), "must not contain ')' ");

function sameRef(
  left: { kind: string; id: string; href?: string },
  right: { kind: string; id: string; href?: string },
): boolean {
  return left.kind === right.kind && (left.id === right.id || (!!left.href && left.href === right.href));
}

function taskHistoryLine(task: {
  id: string;
  text: string;
  done: boolean;
  movedAt?: string;
  abandonedAt?: string;
  jiraKey?: string;
}): string {
  const status = task.done ? "x" : task.movedAt ? ">" : task.abandonedAt ? "~" : " ";
  return `- [${status}] ${task.id} - ${task.text}${task.jiraKey ? ` [${task.jiraKey}]` : ""}`;
}

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
      const summary = `Tasks for ${target} (${day.completed}/${day.total} done, ${day.abandoned} abandoned, ${day.moved} moved):\n${lines.join("\n")}`;

      // Proof of the MCP-UI seam. The text above is unchanged and is what every
      // client still receives; the widget is attached only when the client-side
      // opt-in is on. See ../ui.ts for why this is one tool and not twenty.
      const items = day.tasks
        .map((t) => {
          const meta = [t.jiraKey, t.due ? `due ${t.due}` : null].filter(Boolean).join(" · ");
          return `<li${t.done ? ' class="done"' : ""}><span>${escapeHtml(t.text)}</span>${
            meta ? `<span class="meta">${escapeHtml(meta)}</span>` : ""
          }</li>`;
        })
        .join("\n");
      const html = widgetDocument(
        `Tasks for ${target}`,
        `<h2>${escapeHtml(target)} — ${day.completed}/${day.total} done</h2>\n<ul>\n${items}\n</ul>`,
      );

      return uiResult(summary, html, `ui://devhub/tasks/${target}`);
    },
  );

  server.registerTool(
    "tasks_create",
    {
      description:
        "Create a new task. Auto-extracts Jira keys from text (e.g. DAD-1234). Inline #tags (e.g. 'fix login #auth') become first-class tags — call tags_list first to reuse existing ones. Optionally create a linked task note (EntityRef ## Links) and/or attach hop-around links (PR/calendar/note).",
      inputSchema: {
        text: z
          .string()
          .describe("Task description (1-500 chars). Jira keys like DAD-1234 are auto-detected; inline #tags become hop chips."),
        date: z.string().optional().describe("Date in YYYY-MM-DD format. Defaults to today."),
        due: z.string().optional().describe("Due date in YYYY-MM-DD format."),
        withNote: z.boolean().optional().describe("If true, also create the linked task-notes/ note"),
        links: z
          .array(
            z.object({
              kind: z.enum(["task", "meeting", "pr", "note", "diagram", "calendar", "jira", "repo"]),
              id: z.string(),
              label: z.string(),
              href: z.string().optional(),
            }),
          )
          .optional()
          .describe("EntityRefs to store on the task for hop-around"),
      },
    },
    async ({ text, date, due, withNote, links }) => {
      let task = tasksStorage.add(text, date, due);
      if (links?.length) {
        task = tasksStorage.update(task.id, { links }, date) ?? task;
      }
      let noteLine = "";
      if (withNote) {
        const { buildTaskNoteMarkdown, taskNotePath } = await import(
          "../../../../shared/task-note/index.ts"
        );
        const { textToBlocks } = await import("../convert.ts");
        const day = date || new Date().toISOString().split("T")[0];
        const source = { id: task.id, text: task.text, date: day, jiraKey: task.jiraKey };
        const notePath = taskNotePath(source);
        ctx.storage.write(notePath, textToBlocks(buildTaskNoteMarkdown(source)));
        noteLine = `\nLinked note: ${notePath}`;
      }
      return {
        content: [
          {
            type: "text",
            text: `Created task: ${task.id} — ${task.text}${noteLine}`,
          },
        ],
      };
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
        links: z
          .array(
            z.object({
              kind: z.enum(["task", "meeting", "pr", "note", "diagram", "calendar", "jira", "repo"]),
              id: z.string(),
              label: z.string(),
              href: z.string().optional(),
            }),
          )
          .optional()
          .describe("Replace hop-around EntityRefs on the task"),
      },
    },
    async ({ id, text, done, due, status, abandonReason, date, links }) => {
      const task = tasksStorage.update(id, { text, done, due, status, abandonReason, links }, date);
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
        const lines = day.tasks.map(taskHistoryLine);
        return {
          content: [{ type: "text", text: `${date} (${day.completed}/${day.total} done):\n${lines.join("\n")}` }],
        };
      }
      const days = tasksStorage.list();
      if (days.length === 0) {
        return { content: [{ type: "text", text: "No task history" }] };
      }
      if (includeTasks) {
        const sections = days.map((summary) => {
          const day = tasksStorage.getDay(summary.date);
          return `${summary.date} (${day.completed}/${day.total} done):\n${day.tasks.map(taskHistoryLine).join("\n")}`;
        });
        return { content: [{ type: "text", text: sections.join("\n\n") }] };
      }
      const lines = days.map(
        (d) => `${d.date}: ${d.total} tasks, ${d.completed} done, ${d.abandoned} abandoned, ${d.moved} moved`,
      );
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  server.registerTool(
    "tasks_context_sync",
    {
      description:
        "Merge context into a task and its linked note in one server-side operation: adds canonical #tags to the task text (dedup, existing tags preserved), merges hop-around links by kind+id (never drops existing links), appends missing note link/tag blocks without rewriting rich content, and appends an idempotent keyed implementation summary. Call tags_list first to reuse canonical tag names.",
      inputSchema: {
        id: z.string().trim().min(1).max(200).describe("Task ID (UUID)"),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Date the task belongs to (YYYY-MM-DD). Defaults to today."),
        tags: z
          .array(z.string().trim().min(1).max(64))
          .max(20)
          .optional()
          .describe("Canonical tag ids to add (with or without #). Existing tags are kept; duplicates are dropped."),
        links: z
          .array(
            z.object({
              kind: z.enum(["task", "meeting", "pr", "note", "diagram", "calendar", "jira", "repo"]),
              id: singleLine(500),
              label: linkLabel,
              href: linkHref.optional(),
            }),
          )
          .max(50)
          .optional()
          .describe("EntityRefs to merge into the task by kind+id (existing label/href refreshed when provided)"),
        noteSummary: z
          .string()
          .trim()
          .min(1)
          .max(10_000)
          .optional()
          .describe("Short markdown summary to append to the task note under a keyed '## Implementation <key>' heading"),
        noteSummaryKey: z
          .string()
          .trim()
          .min(1)
          .max(500)
          .optional()
          .describe("Required with noteSummary. Exact idempotency key, e.g. the PR URL or commit SHA."),
      },
    },
    async ({ id, date, tags, links, noteSummary, noteSummaryKey }) => {
      const target = date || new Date().toISOString().split("T")[0];
      const task = tasksStorage.getDay(target).tasks.find((t) => t.id === id);
      if (!task) {
        return { content: [{ type: "text", text: `Task not found: ${id}` }] };
      }
      if (noteSummary && !noteSummaryKey) {
        return {
          isError: true,
          content: [{ type: "text", text: "noteSummaryKey is required when noteSummary is provided." }],
        };
      }

      const requested = (tags ?? [])
        .map((t) => t.replace(/^#/, "").trim().toLowerCase())
        .filter((t) => CONTEXT_TAG_RE.test(t));
      const skippedTags = (tags?.length ?? 0) - requested.length;
      const knownTags = extractTags(task.text);
      const known = new Set(knownTags);
      const requestedTags = [...new Set(requested)];
      const addedTags = requestedTags.filter((t) => !known.has(t));
      const canonicalTags = [...new Set([...knownTags, ...requestedTags])];
      const nextText = addedTags.length ? `${task.text} ${addedTags.map((t) => `#${t}`).join(" ")}` : task.text;
      if (nextText.length > 500) {
        return {
          isError: true,
          content: [{ type: "text", text: "Tag merge would exceed the 500-character task text limit." }],
        };
      }

      const merged = [...(task.links ?? [])];
      let linksAdded = 0;
      let linksUpdated = 0;
      for (const ref of links ?? []) {
        const idx = merged.findIndex((l) => l.kind === ref.kind && l.id === ref.id);
        if (idx === -1) {
          merged.push(ref);
          linksAdded++;
        } else if (
          (ref.label && ref.label !== merged[idx].label) ||
          (ref.href && ref.href !== merged[idx].href)
        ) {
          merged[idx] = { ...merged[idx], label: ref.label || merged[idx].label, href: ref.href || merged[idx].href };
          linksUpdated++;
        }
      }

      const textChanged = nextText !== task.text;
      const linksChanged = linksAdded > 0 || linksUpdated > 0;
      let synced = task;
      if (textChanged || linksChanged) {
        synced = tasksStorage.update(id, { text: nextText, links: merged }, target) ?? task;
      }

      const noteSource = {
        id: synced.id,
        text: synced.text,
        date: target,
        jiraKey: synced.jiraKey,
        related: synced.links ?? merged,
      };
      const notePath = taskNotePath(noteSource);

      const existingNote = ctx.storage.read(notePath);
      const existingMarkdown =
        existingNote?.content != null ? blocksToText(existingNote.content as unknown[]) : null;
      const shouldCreateNote = !existingNote && !!(noteSummary || requestedTags.length);
      const noteCreated = shouldCreateNote;
      let summaryAdded = false;
      let noteChanged = false;

      if (shouldCreateNote) {
        const parts = [buildTaskNoteMarkdown(noteSource)];
        if (canonicalTags.length) parts.push(`Tags: ${canonicalTags.map((tag) => `#${tag}`).join(" ")}`);
        if (noteSummary && noteSummaryKey) {
          parts.push(`## Implementation ${noteSummaryKey}\n\n${noteSummary}`);
          summaryAdded = true;
        }
        ctx.storage.write(notePath, textToBlocks(parts.join("\n\n")));
        noteChanged = true;
      } else if (existingNote && existingMarkdown !== null) {
        const append: string[] = [];
        const existingRefs = parseEntityLinksFromMarkdown(existingMarkdown);
        const missingRefs = taskEntityRefs(noteSource).filter(
          (ref) => !existingRefs.some((existingRef) => sameRef(existingRef, ref)),
        );
        if (missingRefs.length) append.push(buildEntityLinksSection(missingRefs).trim());

        const noteTags = new Set(extractTags(existingMarkdown));
        const missingTags = canonicalTags.filter((tag) => !noteTags.has(tag));
        if (missingTags.length) append.push(`Tags: ${missingTags.map((tag) => `#${tag}`).join(" ")}`);

        if (noteSummary && noteSummaryKey) {
          const heading = `## Implementation ${noteSummaryKey}`;
          const hasSummary = existingMarkdown.split("\n").some((line) => line.trim() === heading);
          if (!hasSummary) {
            append.push(`${heading}\n\n${noteSummary}`);
            summaryAdded = true;
          }
        }

        if (append.length) {
          const currentBlocks = Array.isArray(existingNote.content) ? existingNote.content : [existingNote.content];
          ctx.storage.write(notePath, [...currentBlocks, ...textToBlocks(append.join("\n\n"))]);
          noteChanged = true;
        }
      }

      const changes = [
        addedTags.length ? `tags added: ${addedTags.map((t) => `#${t}`).join(" ")}` : null,
        skippedTags > 0 ? `${skippedTags} invalid tag(s) skipped` : null,
        linksChanged ? `links: +${linksAdded} added, ${linksUpdated} updated` : null,
        existingNote || noteCreated
          ? `note ${notePath}${noteCreated ? " created" : noteChanged ? " updated" : " unchanged"}${noteSummary ? (summaryAdded ? " (summary added)" : " (summary already present)") : ""}`
          : null,
      ].filter(Boolean);
      return {
        content: [
          {
            type: "text",
            text: `Synced task ${id} (${target}):\n${changes.length ? changes.map((c) => `- ${c}`).join("\n") : "- no changes"}`,
          },
        ],
      };
    },
  );

  const { dashboard } = ctx;

  server.registerTool(
    "tasks_agent_runs",
    {
      description:
        "List or upsert agent runs linked to a DevHub task (durable task↔run sidecar + optional handoff). GET-style when only taskId is set; pass runId to link/update a run (status queued|running|paused|done|failed|abandoned). Requires the dashboard. Use before pause/EOD and when starting/resuming implement-task runs.",
      inputSchema: {
        taskId: z.string().trim().min(1).max(128).describe("DevHub task UUID"),
        runId: z
          .string()
          .trim()
          .regex(/^run-[a-z0-9]+-[0-9a-f]+$/, "run id from agent_dispatch / agent_runs")
          .optional()
          .describe("When set, upsert this run onto the task"),
        status: z
          .enum(["queued", "running", "paused", "done", "failed", "abandoned"])
          .optional()
          .describe("Sidecar status (paused for EOD; abandoned when giving up)"),
        provider: z.string().trim().min(1).max(64).optional().describe("Agent provider id, e.g. claude"),
        prUrl: z.string().url().max(2_000).nullable().optional(),
        branch: z.string().trim().min(1).max(300).nullable().optional(),
        sessionId: z.string().trim().min(1).max(200).nullable().optional(),
        terminalSessionId: z.string().trim().min(1).max(200).nullable().optional(),
        handoff: z.string().max(100_000).optional().describe("Optional handoff markdown to set in the same write"),
        handoffMode: z.enum(["replace", "append"]).optional().describe("How to apply handoff (default replace)"),
      },
    },
    async (input) =>
      withDashboardErrors(async () => {
        if (!input.runId) {
          const data = await dashboard.get<{
            taskId: string;
            handoff: string;
            handoffUpdatedAt: string | null;
            runs: Array<Record<string, unknown>>;
          }>("/api/tasks/agent-runs", { taskId: input.taskId });
          const lines = [
            `Task ${data.taskId}: ${data.runs.length} linked run(s)`,
            data.handoffUpdatedAt ? `Handoff updated: ${data.handoffUpdatedAt}` : "Handoff: (none yet)",
            data.handoff ? `\n--- handoff ---\n${data.handoff}\n--- end ---` : null,
            "",
            ...data.runs.map((r) => {
              const bits = [
                r.runId,
                r.status,
                r.provider,
                r.branch ? `branch ${r.branch}` : null,
                r.prUrl ? String(r.prUrl) : null,
              ].filter(Boolean);
              return `- ${bits.join(" · ")}`;
            }),
          ].filter((line) => line !== null);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        }
        const data = await dashboard.post<{
          taskId: string;
          handoff: string;
          handoffUpdatedAt: string | null;
          runs: Array<Record<string, unknown>>;
        }>("/api/tasks/agent-runs", {
          taskId: input.taskId,
          runId: input.runId,
          status: input.status,
          provider: input.provider,
          prUrl: input.prUrl,
          branch: input.branch,
          sessionId: input.sessionId,
          terminalSessionId: input.terminalSessionId,
          handoff: input.handoff,
          handoffMode: input.handoffMode,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `Upserted run ${input.runId} on task ${data.taskId} (${data.runs.length} run(s) linked).`,
            },
          ],
        };
      }),
  );

  server.registerTool(
    "tasks_agent_handoff_get",
    {
      description:
        "Read the durable markdown handoff for a DevHub task (resume: call this before continuing implement-task work). Includes the latest linked agent run when present. Requires the dashboard.",
      inputSchema: {
        taskId: z.string().trim().min(1).max(128).describe("DevHub task UUID"),
      },
    },
    async ({ taskId }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<{
          taskId: string;
          handoff: string;
          handoffUpdatedAt?: string;
          latestRun: Record<string, unknown> | null;
        }>("/api/tasks/agent-runs/handoff", { taskId });
        const lines = [
          `Task ${data.taskId}`,
          data.handoffUpdatedAt ? `Updated: ${data.handoffUpdatedAt}` : null,
          data.latestRun
            ? `Latest run: ${data.latestRun.runId} · ${data.latestRun.status}${data.latestRun.provider ? ` · ${data.latestRun.provider}` : ""}`
            : "Latest run: (none)",
          "",
          data.handoff.trim() ? data.handoff : "(empty handoff)",
        ].filter((line) => line !== null);
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      }),
  );

  server.registerTool(
    "tasks_agent_handoff_set",
    {
      description:
        "Write durable handoff markdown for a DevHub task. Call before pause, end-of-day, or abandon so a later resume can pick up. mode=replace (default) or append. Requires the dashboard.",
      inputSchema: {
        taskId: z.string().trim().min(1).max(128).describe("DevHub task UUID"),
        handoff: z.string().max(100_000).describe("Markdown handoff body"),
        mode: z.enum(["replace", "append"]).optional().describe("replace (default) or append"),
      },
    },
    async ({ taskId, handoff, mode }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.put<{
          taskId: string;
          handoff: string;
          handoffUpdatedAt?: string;
        }>("/api/tasks/agent-runs/handoff", { taskId, handoff, mode });
        return {
          content: [
            {
              type: "text" as const,
              text: `Handoff saved for task ${data.taskId}${data.handoffUpdatedAt ? ` at ${data.handoffUpdatedAt}` : ""} (${data.handoff.length} chars).`,
            },
          ],
        };
      }),
  );

  server.registerTool(
    "tasks_agent_resume",
    {
      description:
        "Resume a DevHub task's agent work. Prefers follow-up on the latest linked run (same CLI session) injecting durable handoff + implement plan URL; otherwise dispatches a new run quoting the handoff and upserts the task↔run sidecar. Requires the dashboard. Compose manually with tasks_agent_handoff_get + agent_followup / agent_dispatch + tasks_agent_runs when you need finer control.",
      inputSchema: {
        taskId: z.string().trim().min(1).max(128).describe("DevHub task UUID"),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
          .describe("Day file the task lives in"),
        provider: z.string().trim().min(1).max(64).optional().describe("Optional agent_dispatch provider id"),
        model: z.string().trim().max(120).optional(),
        cwd: z.string().trim().min(1).max(1_000).optional().describe("Checkout path when starting a new run"),
        origin: z
          .string()
          .url()
          .optional()
          .describe("Dashboard origin for plan URL (defaults to the MCP dashboard base URL)"),
      },
    },
    async (input) =>
      withDashboardErrors(async () => {
        const data = await dashboard.post<{
          mode: "followup" | "new";
          run: { id: string; state: string; providerLabel?: string; title?: string };
          priorRunId: string | null;
          handoffChars: number;
        }>("/api/tasks/agent-runs/resume", {
          taskId: input.taskId,
          date: input.date,
          provider: input.provider,
          model: input.model,
          cwd: input.cwd,
          origin: input.origin,
        });
        const bits = [
          `Resumed task ${input.taskId} via ${data.mode} → ${data.run.id}`,
          data.run.state,
          data.run.providerLabel,
          data.priorRunId ? `prior ${data.priorRunId}` : null,
          `handoff ${data.handoffChars} chars`,
        ].filter(Boolean);
        return { content: [{ type: "text" as const, text: bits.join(" · ") }] };
      }),
  );

  server.registerTool(
    "tasks_implement_ready",
    {
      description:
        "Light ready-to-implement checklist for a DevHub task (acceptance/plan, single repo link or pick, no open #prerequisite/#blocker). Warn by default; hardBlock (prefs or arg) flips to blocked. Proxies GET /api/tasks/implement/ready. Call before agent_dispatch / Implement.",
      inputSchema: {
        taskId: z.string().trim().min(1).max(128).describe("DevHub task UUID"),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
          .optional()
          .describe("Day file the task lives in (defaults to today on the dashboard)"),
        selectedRepoId: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .describe("When multiple kind:repo links exist, the repo to use"),
        hubRepoId: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .describe("Hub checkout owner/repo — satisfies repo when the task has no repo links"),
        hardBlock: z
          .boolean()
          .optional()
          .describe("Override vault prefs; true refuses ready when items fail"),
      },
    },
    async (input) =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<{
          taskId: string;
          date: string;
          ok: boolean;
          warn: boolean;
          blocked: boolean;
          hardBlock: boolean;
          selectedRepoId: string | null;
          items: Array<{
            id: string;
            ok: boolean;
            label: string;
            detail?: string;
            fixHref?: string;
            fixLabel?: string;
          }>;
        }>("/api/tasks/implement/ready", {
          taskId: input.taskId,
          date: input.date,
          selectedRepoId: input.selectedRepoId,
          hubRepoId: input.hubRepoId,
          hardBlock:
            input.hardBlock === undefined ? undefined : input.hardBlock ? "1" : "0",
        });
        const status = data.blocked ? "BLOCKED" : data.ok ? "READY" : "WARN";
        const lines = [
          `Implement ready for task ${data.taskId} (${data.date}): ${status}`,
          data.selectedRepoId ? `Repo: ${data.selectedRepoId}` : "Repo: (unresolved)",
          `hardBlock=${data.hardBlock}`,
          "",
          ...data.items.map((item) => {
            const mark = item.ok ? "ok" : "miss";
            const fix = !item.ok && item.fixHref ? ` → ${item.fixLabel ?? "fix"}: ${item.fixHref}` : "";
            return `- [${mark}] ${item.label}${item.detail ? `: ${item.detail}` : ""}${fix}`;
          }),
        ];
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      }),
  );


}
