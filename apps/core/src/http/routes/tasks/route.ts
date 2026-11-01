import { addTask, setTaskCompletion, reorderOpenTasks, ensureTasksMigrated, taskMigrationNotice, startTaskTimer, stopTaskTimer, present, taskUpdatePatch } from "../../../domains/tasks/storage";
import { todayISO } from "../../../../../../packages/shared/utils.ts";
import {
  TaskCreateSchema,
  TaskPatchSchema,
  TaskDeleteSchema,
  TaskReorderSchema,
  formatZodError,
} from "../../../lib/schemas";
import { withErrorHandler } from "../../../lib/api-utils";
import { currentTaskNode, loadTaskIndex } from "../../../domains/tasks/task-index";
import { isActiveTaskAgentRunStatus, isValidTaskAgentTaskId, listTaskAgentRuns } from "../../../domains/tasks/task-agent-runs";
import { readOrchestration } from "../../../lib/storyboard/orchestration-store";
import { queueReadyLinkedDraftPrs } from "../../../domains/tasks/ready-linked-prs";
import { getActiveTasksDir } from "../../../lib/notes/dir";
import { taskStorage } from "@devhub/core/storage/tasks";
import { taskCompletion, taskCreate, taskDelete, taskList, taskReorder, taskTimerStart, taskTimerStop, taskUpdate } from "../../../../../../packages/shared/actions/tasks";
import { httpAction } from "../../../lib/actions/http";

export const GET = withErrorHandler(async (req: Request) => {
  const params = new URL(req.url).searchParams;
  const taskId = params.get("taskId");
  if (taskId !== null && !/^[a-zA-Z0-9_-]{1,200}$/.test(taskId)) {
    return Response.json({ error: "Invalid taskId" }, { status: 400 });
  }
  await ensureTasksMigrated();
  const date = todayISO();
  const node = taskId ? currentTaskNode(loadTaskIndex(), taskId) : undefined;
  return httpAction(taskList, {
    input: () => ({ date: node?.date ?? date }),
    context: () => ({ storage: () => taskStorage(getActiveTasksDir()), prepare: ensureTasksMigrated, today: todayISO, present }),
    response: (result) => Response.json({
      date: result.date,
      tasks: taskId ? result.tasks.filter((task) => task.id === node?.task.id) : result.tasks,
      migrationNotice: taskMigrationNotice(),
    }),
  })(req);
}, "tasks.get");

export const POST = withErrorHandler(async (req: Request) => {
  const body = await req.json().catch(() => ({}));
  const parsed = TaskCreateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }
  return httpAction(taskCreate, {
    input: () => parsed.data,
    context: () => ({
      prepare: ensureTasksMigrated,
      today: todayISO,
      create: (input) => addTask(input.text.trim(), input.startDate, input.due, input.links, input.stage, input.parentKey),
    }),
    response: ({ task }) => Response.json(task, { status: 201 }),
  })(req);
}, "tasks.post");

export const PATCH = withErrorHandler(async (req: Request) => {
  const body = await req.json().catch(() => ({}));

  if (body && typeof body === "object" && "ids" in body) {
    const parsed = TaskReorderSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }
    return httpAction(taskReorder, {
      input: () => parsed.data,
      context: () => ({ reorder: reorderOpenTasks }),
      response: (result) => result.ok ? Response.json({ tasks: result.tasks }) : Response.json({ error: result.error }, { status: 400 }),
    })(req);
  }

  const parsed = TaskPatchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }
  const { id, completion, date, status, timer } = parsed.data;

  if (completion !== undefined) {
    if (!isValidTaskAgentTaskId(id)) return Response.json({ error: "Invalid task ID" }, { status: 400 });
    if (completion) {
      const orchestration = readOrchestration(id);
      if (orchestration?.status === "starting" || orchestration?.status === "running" || listTaskAgentRuns(id).some((run) => isActiveTaskAgentRunStatus(run.status))) {
        return Response.json({ error: "Work is still running. Wait for it to finish or stop it before finishing this task." }, { status: 409 });
      }
    }
    return httpAction(taskCompletion, {
      input: () => ({ id, completion, date }),
      context: () => ({ set: setTaskCompletion }),
      response: (task) => {
        if (!task) return Response.json({ error: "Not found" }, { status: 404 });
        if (completion && task.done) queueReadyLinkedDraftPrs(task.id, "task completed");
        return Response.json(task);
      },
    })(req);
  }

  if (timer) {
    const context = { start: startTaskTimer, stop: stopTaskTimer };
    const response = (task: Awaited<ReturnType<typeof startTaskTimer>>) => task ? Response.json(task) : Response.json({ error: "Not found" }, { status: 404 });
    if (timer === "start") return httpAction(taskTimerStart, { input: () => ({ id, date, timer: "start" as const }), context: () => context, response })(req);
    return httpAction(taskTimerStop, { input: () => ({ id, date, timer: "stop" as const }), context: () => context, response })(req);
  }

  return httpAction(taskUpdate, {
    input: () => ({ ...parsed.data, status: status === "abandoned" ? "abandon" : status === "active" ? "reactivate" : undefined }),
    context: () => ({
      storage: () => taskStorage(getActiveTasksDir()),
      prepare: ensureTasksMigrated,
      today: todayISO,
      scope: "all" as const,
      present,
      patch: (task, input) => {
        if (input.status === "abandon") return { status: "abandon" as const, abandonReason: input.abandonReason };
        if (input.status === "reactivate") return { status: "reactivate" as const };
        if (input.text !== undefined || input.due !== undefined || input.links !== undefined || input.stage !== undefined) {
          return taskUpdatePatch(task, { text: input.text, due: input.due, links: input.links, stage: input.stage });
        }
        return { status: task.done ? "reactivate" as const : "complete" as const };
      },
    }),
    response: ({ task, completionRequested }) => {
      if (!task) return Response.json({ error: "Not found" }, { status: 404 });
      if (completionRequested && task.done) queueReadyLinkedDraftPrs(task.id, "task completed");
      return Response.json(task);
    },
  })(req);
}, "tasks.patch");

export const DELETE = withErrorHandler(async (req: Request) => {
  const body = await req.json().catch(() => ({}));
  const parsed = TaskDeleteSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }
  return httpAction(taskDelete, {
    input: () => parsed.data,
    context: () => ({ storage: () => taskStorage(getActiveTasksDir()), prepare: ensureTasksMigrated, today: todayISO, scope: "all" as const }),
    response: ({ deleted }) => deleted
      ? Response.json({ ok: true })
      : Response.json({ error: "Not found" }, { status: 404 }),
  })(req);
}, "tasks.delete");
