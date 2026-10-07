import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { formatGenerateError } from "@/lib/ai/generate";
import { isAiConfigured } from "@/lib/ai/preference";
import { notConfigured, parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { draftJiraTicket, JIRA_DRAFT_TIMEOUT_MS } from "@/lib/jira/draft-ticket";
import { getTasks } from "@/lib/tasks/storage";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  taskId: z.string().trim().min(1).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, requestSchema);
  if (!parsed.ok) return parsed.response;

  const { taskId, date } = parsed.data;
  const task = getTasks(date).find((candidate) => candidate.id === taskId);
  if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });
  if (!isAiConfigured()) return notConfigured("AI");

  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(JIRA_DRAFT_TIMEOUT_MS)]);
  try {
    const draft = await draftJiraTicket(task, date, signal);
    return NextResponse.json(draft);
  } catch (error) {
    const timedOut = signal.reason instanceof DOMException && signal.reason.name === "TimeoutError";
    return NextResponse.json({
      error: timedOut ? "Jira draft generation timed out. Try again or write the ticket manually." : formatGenerateError(error),
    }, { status: 502 });
  }
}, "jira/draft");
