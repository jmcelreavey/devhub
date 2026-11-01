import { requireDashboardAuth, withErrorHandler } from "../../../../../lib/api-utils";
import { httpAction } from "../../../../../lib/actions/http";
import { taskImplementReady, type TaskImplementReadyContext } from "../../../../../../../../packages/shared/actions/task-agent";
import { taskStorage } from "@devhub/core/storage/tasks";
import { getActiveTasksDir } from "../../../../../lib/notes/dir";
import { present, ensureTasksMigrated } from "../../../../../domains/tasks/storage";
import { todayISO } from "../../../../../../../../packages/shared/utils.ts";
import { readImplementReadyPrefs } from "../../../../../domains/tasks/implement-ready-prefs";
import { checkTaskImplementReady } from "../../../../../domains/tasks/implement-ready-gather";


/**
 * Light ready-to-implement checklist for a task.
 * Query: taskId (required), date? (YYYY-MM-DD), selectedRepoId?, hardBlock? (1/true overrides prefs).
 */
export const GET = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const taskId = url.searchParams.get("taskId")?.trim();
  const requestedDate = url.searchParams.get("date")?.trim() || undefined;
  const selectedRepoId = url.searchParams.get("selectedRepoId")?.trim() || null;
  const hubRepoId = url.searchParams.get("hubRepoId")?.trim() || null;
  const hardBlockParam = url.searchParams.get("hardBlock")?.trim().toLowerCase();

  if (!taskId) return Response.json({ error: "taskId required" }, { status: 400 });
  if (requestedDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    return Response.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }
  const hardBlock =
    hardBlockParam === "1" || hardBlockParam === "true"
      ? true
      : hardBlockParam === "0" || hardBlockParam === "false"
        ? false
        : undefined;
  const input = { taskId, date: requestedDate, selectedRepoId: selectedRepoId ?? undefined, hubRepoId: hubRepoId ?? undefined, hardBlock };
  const context: TaskImplementReadyContext = { check: async (value) => {
    const date = value.date ?? todayISO();
    await ensureTasksMigrated();
    const found = (await taskStorage(getActiveTasksDir()).onDay(date, todayISO())).find((task) => task.id === value.taskId);
    if (!found) return { ok: false, error: `Task ${value.taskId} not found`, status: 404 };
    const task = present(found, date);
    const prefs = readImplementReadyPrefs();
    const { notePath, noteExists, repoIds, ...result } = await checkTaskImplementReady(task, date, {
      selectedRepoId: value.selectedRepoId ?? null,
      hubRepoId: value.hubRepoId ?? null,
      hardBlock: value.hardBlock ?? prefs.hardBlock,
    });
    return { ok: true, value: { taskId: task.id, date, notePath, noteExists, repoIds, prefsHardBlock: prefs.hardBlock, ...result } };
  } };
  const response = (result: Awaited<ReturnType<TaskImplementReadyContext["check"]>>) => result.ok ? Response.json(result.value) : Response.json({ error: result.error }, { status: result.status });
  if (!taskImplementReady.input.safeParse(input).success) return response(await taskImplementReady.handler(input, context));
  return httpAction(taskImplementReady, { input: () => input, context: () => context, response })(req);
}, "tasks.implement.ready");
