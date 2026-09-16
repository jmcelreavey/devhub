import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import {
  finishInteractiveAgentRun,
  readAgentRun,
  toAgentRunSummary,
} from "@/lib/agent-runs/store";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const Schema = z.object({
  ok: z.boolean(),
  resultText: z.string().trim().max(8_000).optional(),
  sessionId: z.string().trim().max(200).optional(),
  error: z.string().trim().max(2_000).optional(),
});

export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const run = readAgentRun((await params).id);
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });
  if (run.spec.bin !== "interactive") {
    return NextResponse.json({ error: "only interactive runs finish via this route" }, { status: 400 });
  }
  const parsed = await parseBody(req, Schema);
  if (!parsed.ok) return parsed.response;
  const updated = finishInteractiveAgentRun(run, parsed.data);
  return NextResponse.json({ run: toAgentRunSummary(updated) });
}, "agent.runs.finish.post");
