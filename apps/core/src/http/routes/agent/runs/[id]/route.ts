import { AgentDispatchError,dispatchAgentRun } from "../../../../../lib/agent-runs/dispatch";
import { clip } from "../../../../../lib/agent-runs/events";
import { isActiveAgentRunState,readRunEvents } from "../../../../../lib/agent-runs/run-files";
import { cancelAgentRun,readAgentRun,toAgentRunSummary } from "../../../../../lib/agent-runs/store";
import { cancelManagedRun,reconcileManagedRun } from "../../../../../lib/paseo/lifecycle";
import { parseBody,requireDashboardAuth,withErrorHandler } from "../../../../../lib/api-utils";
import { httpAction } from "../../../../../lib/actions/http";
import { agentCancel, agentFollowup, agentFollowupBodyInput, agentOutput } from "../../../../../../../../packages/shared/actions/agents";


interface RouteContext {
  params: Promise<{ id: string }>;
}

function intParam(raw: string | null, fallback: number, min: number, max: number): number {
  const n = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), min), max) : fallback;
}

function notFound(): Response {
  return Response.json({ error: "Agent run not found" }, { status: 404 });
}

/** Run status plus events from the `since` cursor. */
export const GET = withErrorHandler(async (req: Request, { params }: RouteContext) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  let run = readAgentRun((await params).id);
  if (!run) return notFound();
  run = await reconcileManagedRun(run);
  const search = new URL(req.url).searchParams;
  const current = run;
  return httpAction(agentOutput, {
    input: () => ({
      runId: current.spec.id,
      since: intParam(search.get("since"), 0, 0, Number.MAX_SAFE_INTEGER),
      limit: intParam(search.get("limit"), 200, 1, 500),
    }),
    context: () => ({ read: ({ since, limit }) => ({
      run: toAgentRunSummary(current),
      ...readRunEvents(current.dir, since ?? 0, limit ?? 200),
    }) }),
    response: ({ page }) => Response.json(page),
  })(req);
}, "agent.runs.id.get");

export const DELETE = withErrorHandler(async (req: Request, { params }: RouteContext) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const run = readAgentRun((await params).id);
  if (!run) return notFound();
  if (isActiveAgentRunState(run.status.state) && run.spec.runtime === "generation") {
    return Response.json({ error: "Stop this generation from the feature that started it." }, { status: 409 });
  }
  return httpAction(agentCancel, {
    input: () => ({ runId: run.spec.id }),
    context: () => ({ cancel: async () => {
      const { run: updated, outcome } = run.spec.runtime === "aionui" || run.spec.runtime === "paseo" ? await cancelManagedRun(run) : cancelAgentRun(run);
      return { status: 200, body: { run: toAgentRunSummary(updated), outcome } };
    } }),
    response: ({ status, body }) => Response.json(body, { status }),
  })(req);
}, "agent.runs.id.delete");

/** Follow-up: a new turn in the same managed conversation and worktree. */
export const POST = withErrorHandler(async (req: Request, { params }: RouteContext) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const saved = readAgentRun((await params).id);
  if (!saved) return notFound();
  const run = await reconcileManagedRun(saved);
  const parsed = await parseBody(req, agentFollowupBodyInput);
  if (!parsed.ok) return parsed.response;

  if (isActiveAgentRunState(run.status.state)) {
    return Response.json({ error: "Run is still active — wait for it or cancel it first." }, { status: 409 });
  }
  const resumeSessionId = run.status.sessionId;
  if (!resumeSessionId) {
    return Response.json(
      { error: `${run.spec.providerLabel} did not report a session id for this run, so it cannot be resumed.` },
      { status: 409 },
    );
  }
  return httpAction(agentFollowup, {
    input: () => ({ runId: run.spec.id, ...parsed.data }),
    context: () => ({ resume: async () => {
      try {
        const next = await dispatchAgentRun({
          requestId: parsed.data.requestId,
          activity: run.spec.activity ? { ...run.spec.activity, source: "interactive", action: "resume" } : undefined,
          provider: run.spec.provider,
          prompt: parsed.data.prompt,
          cwd: run.spec.cwd,
          title: clip(`↳ ${run.spec.title}`, 80),
          model: parsed.data.model ?? run.spec.model,
          effort: parsed.data.effort ?? run.spec.reasoningEffort,
          maxTurns: parsed.data.maxTurns,
          depth: parsed.data.depth,
          parentRunId: run.spec.id,
          resumeSessionId,
          inherit: { baseSha: run.spec.baseSha, worktree: run.spec.worktree },
        });
        return { status: 201, body: { run: toAgentRunSummary(next) } };
      } catch (err) {
        if (err instanceof AgentDispatchError) {
          return { status: err.status, body: { error: err.message, code: err.code } };
        }
        throw err;
      }
    } }),
    response: ({ status, body }) => Response.json(body, { status }),
  })(req);
}, "agent.runs.id.post");
