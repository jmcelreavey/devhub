import { todayISO } from "../../../../packages/shared/tasks/dates.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../context.ts";
import { taskContextSync, taskCreate, taskDelete, taskHistory, taskList, taskReopen, taskUpdate, type TaskContextSyncContext, type TaskContextSyncResult, type TaskReopenValue, type TaskUpdatePatch } from "../../../../packages/shared/actions/tasks.ts";
import { taskNoteAdd, type TaskNoteAddValue } from "../../../../packages/shared/actions/task-note.ts";
import { taskAgentHandoffGet, taskAgentHandoffSet, taskAgentPlan, taskAgentResume, taskAgentRuns, taskImplementReady, taskImplementReview, taskReviewSettingsGet, taskReviewSettingsSet, type TaskAgentHandoffValue, type TaskAgentResumeValue, type TaskAgentRunValue, type TaskAgentRunsValue, type TaskImplementReadyValue, type TaskImplementReviewValue, type TaskReviewSettingsValue } from "../../../../packages/shared/actions/task-agent.ts";
import { taskStorage } from "../../../../apps/core/src/domains/storage/tasks.ts";
import { registerAction } from "../actions/register.ts";
import { noteFilePath, readNote, writeNote } from "../content-storage.ts";
import { defineAction } from "../../../../packages/shared/actions/define.ts";
import { withDashboardErrors } from "../dashboard-client.ts";
import { callerDepth } from "./agents.ts";
import { escapeHtml, uiResult, widgetDocument } from "../ui.ts";
import { textToBlocks } from "../convert.ts";
import { normalizeTaskLinkState } from "../../../../packages/shared/task-note/index.ts";
import {
  buildTaskNoteMarkdown,
  taskNotePath,
} from "../../../../packages/shared/task-note/index.ts";

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

type ReadyPrOutcome = { url: string; result: string; detail?: string };

async function dashboardActionRequest<Value>(request: () => Promise<Value>): Promise<{ ok: true; value: Value } | { ok: false; error: string; status: number }> {
  try {
    return { ok: true, value: await request() };
  } catch (error) {
    const result = await withDashboardErrors(async () => { throw error; });
    const message = result.content.find((item) => item.type === "text");
    return { ok: false, error: message?.type === "text" ? message.text : "Unexpected error", status: 0 };
  }
}

/** Ask the dashboard to mark a completed task's draft PRs ready; one line for the tool reply ("" when there was nothing to do). */
async function readyLinkedPrsLine(ctx: Context, taskId: string): Promise<string> {
  try {
    const { outcomes = [] } = await ctx.dashboard.post<{ outcomes?: ReadyPrOutcome[] }>("/api/tasks/ready-prs", { taskId, reason: "task completed" }, 60_000);
    const readied = outcomes.filter((o) => o.result === "readied").map((o) => o.url);
    const failed = outcomes.filter((o) => o.result === "failed");
    const parts = [];
    if (readied.length) parts.push(`Marked ready for review: ${readied.join(", ")}.`);
    if (failed.length) parts.push(`Couldn't mark ready (logged on the task note): ${failed.map((o) => `${o.url} (${o.detail ?? "error"})`).join(", ")}.`);
    return parts.join(" ");
  } catch (error) {
    return `Couldn't check this task's draft PRs (is the dashboard running?): ${error instanceof Error ? error.message : String(error)}. Run \`gh pr ready <url>\` on any draft PR it opened.`;
  }
}

export function registerTasksTools(server: McpServer, ctx: Context): void {
  const { tasksStorage } = ctx;

  registerAction(server, taskNoteAdd, {
    add: ({ id, text, updateAgent, noteId, confirmStop }) => ctx.dashboard.post<TaskNoteAddValue>("/api/tasks/note/add", { taskId: id, text, ...(updateAgent !== undefined ? { updateAgent } : {}), ...(noteId ? { noteId } : {}), ...(confirmStop !== undefined ? { confirmStop } : {}) }),
    classifyError: async (error) => {
      const result = await withDashboardErrors(async () => { throw error; });
      const message = result.content.find((item) => item.type === "text");
      return { error: message?.type === "text" ? message.text : "Unexpected error", status: 0 };
    },
  }, (result) => result.ok
    ? { content: [{ type: "text", text: `Note saved to ${result.id}${result.value.agent.error ? `. ${result.value.agent.error}` : result.value.agent.mode === "none" ? "" : ` · ${result.value.agent.mode}`}` }], structuredContent: { ...result.value, target: result.id } }
    : { content: [{ type: "text", text: result.error }], isError: true });

  registerAction(server, taskReopen, {
    reopen: async (input) => {
      try {
        return { ok: true, value: await ctx.dashboard.post<TaskReopenValue>("/api/tasks/reopen", input) };
      } catch (error) {
        const result = await withDashboardErrors(async () => { throw error; });
        const message = result.content.find((item) => item.type === "text");
        return { ok: false, error: message?.type === "text" ? message.text : "Unexpected error", status: 0 };
      }
    },
  }, (result) => result.ok
    ? { content: [{ type: "text", text: `Updated task: ${result.value.task?.id ?? result.id} — ${result.value.task?.text ?? result.id} (${result.value.alreadyOpen ? "already open" : `reopened in ${result.value.column ?? "In progress"}`})` }] }
    : { content: [{ type: "text", text: result.error }], isError: true });

  registerAction(server, taskList, {
    storage: () => taskStorage(ctx.tasksDir),
    prepare: () => tasksStorage.ready(),
    today: todayISO,
    present: (task, date) => ({ ...task, notePath: tasksStorage.resolveNotePath(task, date) }),
  }, (day) => {
      const target = day.date;
      if (day.tasks.length === 0) {
        return { content: [{ type: "text", text: `No tasks for ${target}` }] };
      }
      const lines = day.tasks.map((t) => {
        const status = t.done ? "x" : t.movedAt || t.endReason === "legacy-moved" ? ">" : t.abandonedAt ? "~" : " ";
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
    });

  registerAction(server, taskCreate, {
    prepare: () => tasksStorage.ready(),
    today: todayISO,
    create: (input) => taskStorage(ctx.tasksDir).withWriteLock(async (storage) => {
      const task = await storage.create({ ...input, links: undefined });
      if (!input.links?.length) return task;
      const normalized = normalizeTaskLinkState(task.text, task.jiraKey, input.links, task.parentKey);
      return await storage.patch(task.id, {
        text: normalized.text,
        links: normalized.links?.length ? normalized.links : [],
        ...(normalized.jiraKey ? { jiraKey: normalized.jiraKey } : {}),
      }) ?? task;
    }),
    createNote: async (task, date) => {
      const source = { ...task, date };
      const notePath = taskNotePath(source);
      await writeNote(ctx.noteContent, notePath, textToBlocks(buildTaskNoteMarkdown(source)), null);
      return notePath;
    },
  }, ({ task, notePath }) => ({
    content: [{ type: "text", text: `Created task: ${task.id} — ${task.text}${notePath ? `\nLinked note: ${notePath}` : ""}` }],
  }));

  registerAction(server, taskUpdate, {
    storage: () => taskStorage(ctx.tasksDir),
    prepare: () => tasksStorage.ready(),
    today: todayISO,
    scope: "day",
    present: (task, date) => ({ ...task, notePath: tasksStorage.resolveNotePath(task, date) }),
    patch: (task, input) => {
      const patch: TaskUpdatePatch = {};
      if (typeof input.text === "string") patch.text = input.text;
      if (input.due !== undefined) patch.due = input.due;
      if (input.stage) patch.stage = input.stage;
      if (input.links !== undefined) {
        const normalized = normalizeTaskLinkState(patch.text ?? task.text, task.jiraKey, input.links, task.parentKey);
        patch.text = normalized.text;
        patch.links = normalized.links?.length ? normalized.links : [];
        if (normalized.jiraKey) patch.jiraKey = normalized.jiraKey;
      }
      if (input.status === "complete" || input.done === true) patch.status = "complete";
      else if (input.status === "abandon") {
        patch.status = "abandon";
        patch.abandonReason = input.abandonReason;
      } else if (input.status === "reactivate" || input.done === false) patch.status = "reactivate";
      return patch;
    },
  }, async ({ id, task, completionRequested }) => {
    if (!task) return { content: [{ type: "text", text: `Task not found: ${id}` }] };
    const lines = [`Updated task: ${task.id} — ${task.text} (done=${task.done}, stage=${task.stage ?? "ready"})`];
    if (task.done && completionRequested) lines.push(await readyLinkedPrsLine(ctx, task.id));
    return { content: [{ type: "text", text: lines.filter(Boolean).join("\n") }] };
  });

  registerAction(server, taskDelete, { storage: () => taskStorage(ctx.tasksDir), prepare: () => tasksStorage.ready(), today: todayISO, scope: "day" }, ({ id, deleted }) => ({
    content: [{ type: "text", text: deleted ? `Deleted task: ${id}` : `Task not found: ${id}` }],
  }));

  registerAction(server, taskHistory, {
    storage: () => taskStorage(ctx.tasksDir),
    prepare: () => tasksStorage.ready(),
    today: todayISO,
    present: (task, date) => ({ ...task, notePath: tasksStorage.resolveNotePath(task, date) }),
    modified: () => 0,
  }, ({ date, query, includeTasks, days, matches, older }) => {
    if (query) {
      if (!matches.length) return { content: [{ type: "text", text: `No tasks matching "${query}"${date ? ` on ${date}` : ""}` }] };
      const lines = matches.map(({ date: day, task }) => `- ${day} ${taskHistoryLine(task).slice(2)}${task.notePath ? ` (note: ${task.notePath})` : ""}`);
      return { content: [{ type: "text", text: `${matches.length} matching task(s):\n${lines.join("\n")}` }] };
    }
    if (date) {
      const day = days[0];
      if (!day?.tasks.length) return { content: [{ type: "text", text: `No tasks for ${date}` }] };
      if (!includeTasks) return { content: [{ type: "text", text: `${date}: ${day.total} tasks, ${day.completed} done, ${day.abandoned} abandoned, ${day.moved} moved` }] };
      return { content: [{ type: "text", text: `${date} (${day.completed}/${day.total} done):\n${day.tasks.map(taskHistoryLine).join("\n")}` }] };
    }
    if (!days.length) return { content: [{ type: "text", text: "No task history" }] };
    if (includeTasks) {
      const sections = days.map((day) => `${day.date} (${day.completed}/${day.total} done):\n${day.tasks.map(taskHistoryLine).join("\n")}`);
      const more = older > 0 ? `\n\n(${older} older day(s) not shown — raise days, or pass date/query.)` : "";
      return { content: [{ type: "text", text: sections.join("\n\n") + more }] };
    }
    return { content: [{ type: "text", text: days.map((day) => `${day.date}: ${day.total} tasks, ${day.completed} done, ${day.abandoned} abandoned, ${day.moved} moved`).join("\n") }] };
  });

  registerAction(server, defineAction({
    ...taskContextSync,
    handler: async (input, context: TaskContextSyncContext): Promise<TaskContextSyncResult> => {
      await context.prepare();
      const today = context.today();
      const date = input.date || today;
      const task = (await taskStorage(ctx.tasksDir).onDay(date, today)).find((item) => item.id === input.id || item.legacyIds?.includes(input.id));
      if (!task) return { text: `Task not found: ${input.id}` };
      const notePath = taskNotePath({ ...task, date, notePath: tasksStorage.resolveNotePath(task, date) });
      const existing = await readNote(ctx.noteContent, notePath);
      let pending: unknown;
      const checkPath = (value: string) => {
        if (noteFilePath(value) !== noteFilePath(notePath)) throw new Error("Task note changed while syncing; retry.");
      };
      const result = await taskContextSync.handler(input, {
        ...context,
        notes: {
          read: (value) => { checkPath(value); return existing; },
          write: (value, blocks) => { checkPath(value); pending = blocks; },
        },
      });
      if (pending !== undefined) await writeNote(ctx.noteContent, notePath, pending, existing?.revision ?? null);
      return result;
    },
  }), {
    storage: () => taskStorage(ctx.tasksDir),
    notes: { read: () => null, write: () => { throw new Error("No note snapshot"); } },
    prepare: () => tasksStorage.ready(),
    today: todayISO,
    present: (task, date) => ({ ...task, notePath: tasksStorage.resolveNotePath(task, date) }),
  }, ({ text, isError }) => ({ content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) }));

  const { dashboard } = ctx;

  registerAction(server, taskAgentRuns, {
    list: (taskId) => dashboardActionRequest(() => dashboard.get<TaskAgentRunsValue>("/api/tasks/agent-runs", { taskId })),
    upsert: (input) => dashboardActionRequest(() => dashboard.post<TaskAgentRunsValue>("/api/tasks/agent-runs", input)),
  }, (result) => {
    if (!result.ok) return { content: [{ type: "text", text: result.error }], isError: true };
    const data = result.value;
    if (result.runId) return { content: [{ type: "text", text: `Upserted run ${result.runId} on task ${data.taskId} (${data.runs.length} run(s) linked).` }] };
    const lines = [
      `Task ${data.taskId}: ${data.runs.length} linked run(s)`,
      data.handoffUpdatedAt ? `Handoff updated: ${data.handoffUpdatedAt}` : "Handoff: (none yet)",
      data.handoff ? `\n--- handoff ---\n${data.handoff}\n--- end ---` : null,
      "",
      ...data.runs.map((run) => {
        const bits = [run.runId, run.status, run.provider, run.branch ? `branch ${run.branch}` : null, run.prUrl ? String(run.prUrl) : null].filter(Boolean);
        return `- ${bits.join(" · ")}`;
      }),
    ].filter((line) => line !== null);
    return { content: [{ type: "text", text: lines.join("\n") }] };
  });

  registerAction(server, taskAgentHandoffGet, {
    read: (taskId) => dashboardActionRequest(() => dashboard.get<TaskAgentHandoffValue>("/api/tasks/agent-runs/handoff", { taskId })),
  }, (result) => {
    if (!result.ok) return { content: [{ type: "text", text: result.error }], isError: true };
    const data = result.value;
    const lines = [
      `Task ${data.taskId}`,
      data.handoffUpdatedAt ? `Updated: ${data.handoffUpdatedAt}` : null,
      data.latestRun
        ? `Latest run: ${data.latestRun.runId} · ${data.latestRun.status}${data.latestRun.provider ? ` · ${data.latestRun.provider}` : ""}`
        : "Latest run: (none)",
      "",
      data.handoff.trim() ? data.handoff : "(empty handoff)",
    ].filter((line) => line !== null);
    return { content: [{ type: "text", text: lines.join("\n") }] };
  });

  registerAction(server, taskAgentHandoffSet, {
    write: (input) => dashboardActionRequest(() => dashboard.put<TaskAgentHandoffValue>("/api/tasks/agent-runs/handoff", input)),
  }, (result) => result.ok
    ? { content: [{ type: "text", text: `Handoff saved for task ${result.value.taskId}${result.value.handoffUpdatedAt ? ` at ${result.value.handoffUpdatedAt}` : ""} (${result.value.handoff.length} chars).` }] }
    : { content: [{ type: "text", text: result.error }], isError: true });

  registerAction(server, taskAgentResume, {
    resume: (input) => dashboardActionRequest(() => dashboard.post<TaskAgentResumeValue>("/api/tasks/agent-runs/resume", input)),
  }, (result) => {
    if (!result.ok) return { content: [{ type: "text", text: result.error }], isError: true };
    const data = result.value;
    const bits = [
      `Resumed task ${result.taskId} via ${data.mode} → ${data.run.id}`,
      data.run.state,
      data.run.providerLabel,
      data.priorRunId ? `prior ${data.priorRunId}` : null,
      `handoff ${data.handoffChars} chars`,
    ].filter(Boolean);
    return { content: [{ type: "text", text: bits.join(" · ") }] };
  });

  registerAction(server, taskAgentPlan, {
    plan: (input) => dashboardActionRequest(() => dashboard.post<{ run: TaskAgentRunValue }>("/api/tasks/agent-runs/plan", { ...input, depth: callerDepth() })),
  }, (result) => {
    if (!result.ok) return { content: [{ type: "text", text: result.error }], isError: true };
    const data = result.value;
    const bits = [`Started a plan-only run for task ${result.taskId} → ${data.run.id}`, data.run.state, data.run.providerLabel, "stops after the plan; write restrictions depend on provider"].filter(Boolean);
    return { content: [{ type: "text", text: bits.join(" · ") }] };
  });

  registerAction(server, taskImplementReady, {
    check: (input) => dashboardActionRequest(() => dashboard.get<TaskImplementReadyValue>("/api/tasks/implement/ready", {
      taskId: input.taskId,
      date: input.date,
      selectedRepoId: input.selectedRepoId,
      hubRepoId: input.hubRepoId,
      hardBlock: input.hardBlock === undefined ? undefined : input.hardBlock ? "1" : "0",
    })),
  }, (result) => {
    if (!result.ok) return { content: [{ type: "text", text: result.error }], isError: true };
    const data = result.value;
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
    return { content: [{ type: "text", text: lines.join("\n") }] };
  });

  const reviewerLine = (r: { provider: string; model: string | null | ""; effort?: string }) =>
    r.provider ? `${r.provider}${r.model ? ` / ${r.model}` : " (provider default model)"}${r.effort ? ` · effort ${r.effort}` : ""}` : "none: the implementing agent reviews its own diff";

  registerAction(server, taskReviewSettingsGet, {
    read: () => dashboardActionRequest(() => dashboard.get<TaskReviewSettingsValue>("/api/tasks/implement/review-settings")),
  }, (result) => result.ok
    ? { content: [{ type: "text", text: `Implement reviewer: ${reviewerLine(result.value)}` }] }
    : { content: [{ type: "text", text: result.error }], isError: true });

  registerAction(server, taskReviewSettingsSet, {
    save: (input) => dashboardActionRequest(() => dashboard.put<TaskReviewSettingsValue>("/api/tasks/implement/review-settings", input)),
  }, (result) => result.ok
    ? { content: [{ type: "text", text: `Implement reviewer set: ${reviewerLine(result.value)}` }] }
    : { content: [{ type: "text", text: result.error }], isError: true });

  registerAction(server, taskImplementReview, {
    review: (input) => dashboardActionRequest(() => dashboard.post<TaskImplementReviewValue>("/api/tasks/implement/review", { ...input, depth: callerDepth() })),
  }, (result) => result.ok
    ? { content: [{ type: "text", text: [
      `Review started by ${reviewerLine(result.value.reviewer)}: ${result.value.run.id} (${result.value.run.state}).`,
      `Note: ${result.value.notePath}`,
      `Next: agent_wait(runId="${result.value.run.id}"), then notes_read the note and fix every must-fix finding.`,
    ].join("\n") }] }
    : { content: [{ type: "text", text: result.error }], isError: true });
}
