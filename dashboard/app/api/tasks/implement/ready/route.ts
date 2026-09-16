import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { getTasks } from "@/lib/tasks/storage";
import { readImplementReadyPrefs } from "@/lib/tasks/implement-ready-prefs";
import { checkTaskImplementReady } from "@/lib/tasks/implement-ready-gather";

export const dynamic = "force-dynamic";

/**
 * Light ready-to-implement checklist for a task.
 * Query: taskId (required), date? (YYYY-MM-DD), selectedRepoId?, hardBlock? (1/true overrides prefs).
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;

  const url = req.nextUrl;
  const taskId = url.searchParams.get("taskId")?.trim();
  const requestedDate = url.searchParams.get("date")?.trim() || undefined;
  const selectedRepoId = url.searchParams.get("selectedRepoId")?.trim() || null;
  const hubRepoId = url.searchParams.get("hubRepoId")?.trim() || null;
  const hardBlockParam = url.searchParams.get("hardBlock")?.trim().toLowerCase();

  if (!taskId) return NextResponse.json({ error: "taskId required" }, { status: 400 });
  if (requestedDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }
  const date = requestedDate ?? new Date().toISOString().slice(0, 10);

  const task = getTasks(date).find((t) => t.id === taskId);
  if (!task) return NextResponse.json({ error: `Task ${taskId} not found` }, { status: 404 });

  const prefs = readImplementReadyPrefs();
  const hardBlock =
    hardBlockParam === "1" || hardBlockParam === "true"
      ? true
      : hardBlockParam === "0" || hardBlockParam === "false"
        ? false
        : prefs.hardBlock;

  const { notePath, repoIds, ...result } = await checkTaskImplementReady(task, date, {
    selectedRepoId,
    hubRepoId,
    hardBlock,
  });

  return NextResponse.json({
    taskId: task.id,
    date,
    notePath,
    repoIds,
    prefsHardBlock: prefs.hardBlock,
    ...result,
  });
}, "tasks.implement.ready");
