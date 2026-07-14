import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withErrorHandler, parseBody, isSameOrigin } from "@/lib/api-utils";
import { listTasks, createResearchTask } from "@/lib/briefing-tasks";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" } as const;

export const GET = withErrorHandler(async () => {
  return NextResponse.json({ ok: true, tasks: listTasks() }, { headers: NO_STORE });
}, "briefing.tasks.list");

export const POST = withErrorHandler(async (request: NextRequest) => {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { topic } = await parseBody<{ topic?: string }>(request);
  const task = await createResearchTask(String(topic ?? ""));
  if (!task) return NextResponse.json({ ok: false, error: "A topic of at least 3 characters is required" }, { status: 400 });
  return NextResponse.json({ ok: true, task }, { headers: NO_STORE });
}, "briefing.tasks.create");
