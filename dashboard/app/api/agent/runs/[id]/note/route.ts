import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import {
  appendInteractiveAgentNote,
  readAgentRun,
  toAgentRunSummary,
} from "@/lib/agent-runs/store";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const Schema = z.object({
  text: z.string().trim().min(1).max(8_000),
});

export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const run = readAgentRun((await params).id);
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });
  if (run.spec.bin !== "interactive") {
    return NextResponse.json({ error: "only interactive runs accept notes via this route" }, { status: 400 });
  }
  const parsed = await parseBody(req, Schema);
  if (!parsed.ok) return parsed.response;
  const updated = appendInteractiveAgentNote(run, parsed.data.text);
  return NextResponse.json({ run: toAgentRunSummary(updated) });
}, "agent.runs.note.post");
