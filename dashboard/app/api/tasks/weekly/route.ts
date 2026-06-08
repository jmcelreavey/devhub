import { NextResponse } from "next/server";
import { listTaskDays } from "@/lib/tasks-storage";
import { buildWeeklyReview } from "@/lib/tasks-weekly";
import { localCalendarDateISO } from "@/lib/local-calendar-date";
import { withErrorHandler } from "@/lib/api-utils";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(async (request: Request) => {
  const url = new URL(request.url);
  const endParam = url.searchParams.get("end");
  const end = endParam && DATE_RE.test(endParam) ? endParam : localCalendarDateISO();
  const review = buildWeeklyReview(listTaskDays(), end);
  return NextResponse.json(review);
}, "tasks.weekly");
