import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withErrorHandler, parseBody } from "@/lib/api-utils";
import { BriefingTaskCreateSchema } from "@/lib/schemas";
import { listTasks, createResearchTask } from "@/lib/briefing-tasks";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" } as const;

export const GET = withErrorHandler(async () => {
  return NextResponse.json({ ok: true, tasks: listTasks() }, { headers: NO_STORE });
}, "briefing.tasks.list");

export const POST = withErrorHandler(async (request: NextRequest) => {
  const parsed = await parseBody(request, BriefingTaskCreateSchema);
  if (!parsed.ok) return parsed.response;
  const task = await createResearchTask(parsed.data.topic);
  if (!task) return NextResponse.json({ ok: false, error: "Could not create the research task" }, { status: 400 });
  return NextResponse.json({ ok: true, task }, { headers: NO_STORE });
}, "briefing.tasks.create");
