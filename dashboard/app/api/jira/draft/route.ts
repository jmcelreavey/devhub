import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { formatGenerateError } from "@/lib/ai/generate";
import { isAiConfigured } from "@/lib/ai/preference";
import { notConfigured, parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { DRAFT_NDJSON_TYPE, DraftStepError, type DraftEvent } from "@/lib/jira/draft-events";
import { draftJiraTicket, JIRA_DRAFT_TIMEOUT_MS } from "@/lib/jira/draft-ticket";
import { getTasks, ensureTasksMigrated } from "@/lib/tasks/storage";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  taskId: z.string().trim().min(1).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const encoder = new TextEncoder();

function wantsDraftStream(req: NextRequest): boolean {
  return (req.headers.get("accept") ?? "").includes(DRAFT_NDJSON_TYPE);
}

function draftErrorMessage(error: unknown, signal: AbortSignal): string {
  const timedOut = signal.reason instanceof DOMException && signal.reason.name === "TimeoutError";
  return timedOut
    ? "Jira draft generation timed out. Try again or write the ticket manually."
    : formatGenerateError(error);
}

export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, requestSchema);
  if (!parsed.ok) return parsed.response;

  const { taskId, date } = parsed.data;
  await ensureTasksMigrated();
  const task = getTasks(date).find((candidate) => candidate.id === taskId);
  if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });
  if (!isAiConfigured()) return notConfigured("AI");

  const started = performance.now();
  const clientAbort = new AbortController();
  const signal = AbortSignal.any([req.signal, clientAbort.signal, AbortSignal.timeout(JIRA_DRAFT_TIMEOUT_MS)]);

  if (!wantsDraftStream(req)) {
    try {
      const draft = await draftJiraTicket(task, date, signal);
      return NextResponse.json(draft);
    } catch (error) {
      return NextResponse.json({ error: draftErrorMessage(error, signal) }, { status: 502 });
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: DraftEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          clientAbort.abort();
        }
      };
      try {
        const draft = await draftJiraTicket(task, date, signal, send);
        send({ type: "result", draft, totalMs: Math.round(performance.now() - started) });
        controller.close();
      } catch (error) {
        if (req.signal.aborted || clientAbort.signal.aborted) {
          try { controller.close(); } catch { /* already closed */ }
          return;
        }
        send({
          type: "error",
          step: error instanceof DraftStepError ? error.step : null,
          message: draftErrorMessage(error, signal),
          totalMs: Math.round(performance.now() - started),
        });
        try { controller.close(); } catch { /* already closed */ }
      }
    },
    cancel() {
      clientAbort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": DRAFT_NDJSON_TYPE,
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}, "jira/draft");
