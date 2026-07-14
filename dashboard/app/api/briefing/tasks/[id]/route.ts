import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { getTask, getTaskResultMarkdown } from "@/lib/briefing-tasks";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" } as const;

export const GET = withErrorHandler(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  const markdown = task.status === "done" ? getTaskResultMarkdown(id) : null;
  return NextResponse.json({ ok: true, task, markdown }, { headers: NO_STORE });
}, "briefing.tasks.get");
