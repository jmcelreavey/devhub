import { NextResponse } from "next/server";
import { ensureTasksMigrated, getTasks, listTaskDays, listTaskFiles } from "@/lib/tasks/storage";
import { withErrorHandler } from "@/lib/api-utils";

export const GET = withErrorHandler(async (req: Request) => {
  await ensureTasksMigrated();
  const url = new URL(req.url);
  const date = url.searchParams.get("date");

  if (date) {
    const tasks = getTasks(date);
    return NextResponse.json({ date, tasks });
  }

  if (url.searchParams.get("includeTasks") === "1") {
    const days = listTaskDays();
    return NextResponse.json(days);
  }

  const days = listTaskFiles();
  return NextResponse.json(days);
}, "tasks.history");
