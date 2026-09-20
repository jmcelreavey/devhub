import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { getTasks, updateTask } from "@/lib/tasks/storage";
import { checkTaskImplementReady } from "@/lib/tasks/implement-ready-gather";

export const dynamic = "force-dynamic";

const StageSchema = z.object({
  taskId: z.string().trim().min(1).max(128),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  stage: z.enum(["draft", "ready"]),
  /** Mark ready even though the checklist has gaps. */
  force: z.boolean().optional(),
});

/**
 * Move a task between draft and ready. Ready means an agent can run the plan
 * without design questions, so it goes through the implement checklist first
 * (409 with the failing items unless `force`).
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, StageSchema);
  if (!parsed.ok) return parsed.response;
  const { taskId, date, stage, force } = parsed.data;

  const task = getTasks(date).find((t) => t.id === taskId);
  if (!task) return NextResponse.json({ error: `Task ${taskId} not found on ${date}` }, { status: 404 });

  if (stage === "ready" && !force) {
    const ready = await checkTaskImplementReady(task, date, { hardBlock: true, requirePlanSection: true });
    if (!ready.ok) {
      const gaps = ready.items.filter((item) => !item.ok);
      return NextResponse.json(
        { error: `Not ready: ${gaps.map((item) => item.label).join(", ")}`, items: gaps },
        { status: 409 },
      );
    }
  }

  const updated = await updateTask(taskId, { stage }, date);
  if (!updated) return NextResponse.json({ error: `Task ${taskId} not found on ${date}` }, { status: 404 });
  return NextResponse.json(updated);
}, "tasks.stage.post");
