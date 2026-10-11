import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireDashboardAuth, parseBody, withErrorHandler } from "@/lib/api-utils";
import { browserCredential, browserObserve, browserRequest } from "@/lib/browser/commands";
import { BrowserActionSchema } from "@/lib/browser/types";
const Schema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("session"), taskId: z.string().min(1).max(200), runId: z.string().min(1).max(200) }).strict(),
  z.object({ operation: z.literal("observe"), sessionId: z.string().uuid(), lease: z.string().regex(/^[\w-]{43}$/) }).strict(),
  z.object({ operation: z.literal("request"), sessionId: z.string().uuid(), lease: z.string().regex(/^[\w-]{43}$/), action: BrowserActionSchema }).strict(),
]);
export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req); if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, Schema); if (!parsed.ok) return parsed.response;
  const input = parsed.data;
  try {
    const result = input.operation === "session" ? browserCredential(input.taskId, input.runId)
      : input.operation === "observe" ? await browserObserve(input.sessionId, input.lease)
      : await browserRequest(input.sessionId, input.lease, input.action);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Browser command was rejected or interrupted. Check the session in DevHub, obtain its current lease and observe again. Never retry a submission without checking its outcome." }, { status: 409 });
  }
}, "browser.agent");
