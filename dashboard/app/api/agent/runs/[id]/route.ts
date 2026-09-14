import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { AgentDispatchError, dispatchAgentRun } from "@/lib/agent-runs/dispatch";
import { clip } from "@/lib/agent-runs/events";
import { isActiveAgentRunState, readRunEvents } from "@/lib/agent-runs/run-files";
import { cancelAgentRun, readAgentRun, toAgentRunSummary } from "@/lib/agent-runs/store";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function intParam(raw: string | null, fallback: number, min: number, max: number): number {
  const n = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), min), max) : fallback;
}

function notFound(): NextResponse {
  return NextResponse.json({ error: "Agent run not found" }, { status: 404 });
}

/** Run status plus events from the `since` cursor. */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const run = readAgentRun((await params).id);
  if (!run) return notFound();
  const search = new URL(req.url).searchParams;
  const page = readRunEvents(
    run.dir,
    intParam(search.get("since"), 0, 0, Number.MAX_SAFE_INTEGER),
    intParam(search.get("limit"), 200, 1, 500),
  );
  return NextResponse.json({ run: toAgentRunSummary(run), ...page });
}, "agent.runs.id.get");

export const DELETE = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const run = readAgentRun((await params).id);
  if (!run) return notFound();
  const { run: updated, outcome } = cancelAgentRun(run);
  return NextResponse.json({ run: toAgentRunSummary(updated), outcome });
}, "agent.runs.id.delete");

const FollowupSchema = z.object({
  prompt: z.string().trim().min(1, "prompt is required").max(32_000, "prompt too long"),
  model: z.string().trim().max(120).optional(),
  maxTurns: z.number().int().min(1).max(500).optional(),
  depth: z.number().int().min(0).max(20).default(0),
});

/** Follow-up: a new run resuming this run's CLI session, in the same cwd/worktree. */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteContext) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const run = readAgentRun((await params).id);
  if (!run) return notFound();
  const parsed = await parseBody(req, FollowupSchema);
  if (!parsed.ok) return parsed.response;

  if (isActiveAgentRunState(run.status.state)) {
    return NextResponse.json({ error: "Run is still active — wait for it or cancel it first." }, { status: 409 });
  }
  if (!run.status.sessionId) {
    return NextResponse.json(
      { error: `${run.spec.providerLabel} did not report a session id for this run, so it cannot be resumed.` },
      { status: 409 },
    );
  }
  try {
    const next = await dispatchAgentRun({
      provider: run.spec.provider,
      prompt: parsed.data.prompt,
      cwd: run.spec.cwd,
      title: clip(`↳ ${run.spec.title}`, 80),
      model: parsed.data.model ?? run.spec.model,
      maxTurns: parsed.data.maxTurns,
      depth: parsed.data.depth,
      parentRunId: run.spec.id,
      resumeSessionId: run.status.sessionId,
      inherit: { baseSha: run.spec.baseSha, worktree: run.spec.worktree },
    });
    return NextResponse.json({ run: toAgentRunSummary(next) }, { status: 201 });
  } catch (err) {
    if (err instanceof AgentDispatchError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}, "agent.runs.id.post");
