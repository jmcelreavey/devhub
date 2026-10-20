import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { readNotesBoard } from "@/lib/storyboard/notes-board";
import { readAgentRun } from "@/lib/agent-runs/store";
import { readRunEvents } from "@/lib/agent-runs/run-files";
import { describeAgentEvent } from "@/lib/agent-runs/events";

export const dynamic = "force-dynamic";
export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const card = readNotesBoard({ doneWindowDays: null }).cards.find((item) => item.taskId === req.nextUrl.searchParams.get("taskId"));
  if (!card?.failure) return NextResponse.json({ error: "No failure for this task in the active profile." }, { status: 404 });
  const run = card.failure.runId ? readAgentRun(card.failure.runId) : null;
  const events = run ? readRunEvents(run.dir, Math.max(0, run.status.eventCount - 100), 100).events : [];
  return NextResponse.json({ lines: [card.failure.summary, ...events.map(describeAgentEvent)] });
}, "tasks.failure.logs");
