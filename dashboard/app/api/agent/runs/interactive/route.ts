import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { interactiveRunWrap } from "@/lib/agent-runs/launch";
import { listAgentProviders } from "@/lib/agent-runs/providers";
import {
  createInteractiveAgentRun,
  isValidAgentRunId,
  newAgentRunId,
  toAgentRunSummary,
} from "@/lib/agent-runs/store";
import { upsertTaskAgentRun } from "@/lib/tasks/task-agent-runs";
import { mapUiProviderToAgentDispatch } from "@/lib/tasks/task-agent-resume";

export const dynamic = "force-dynamic";

const Schema = z.object({
  provider: z.string().trim().min(1).max(64),
  prompt: z.string().trim().min(1).max(32_000),
  cwd: z.string().trim().min(1).max(1_000),
  title: z.string().trim().max(80).optional(),
  model: z.string().trim().max(120).optional(),
  sessionId: z.string().trim().max(200).optional(),
  parentRunId: z.string().trim().max(64).optional(),
  taskId: z.string().trim().min(1).max(80).optional(),
  runId: z.string().trim().max(64).optional(),
});

/**
 * Register an interactive CLI session in Agent Activity. The response's `wrap`
 * fragments go around the CLI command so the tab reports start and exit.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, Schema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const runId = body.runId?.trim() || newAgentRunId();
  if (!isValidAgentRunId(runId)) {
    return NextResponse.json({ error: "invalid runId" }, { status: 400 });
  }
  const mapped = mapUiProviderToAgentDispatch(body.provider) ?? body.provider.trim();
  const { providers } = listAgentProviders();
  const hit = providers.find((p) => p.spec.id === mapped);
  const provider = hit?.spec.id ?? mapped;
  const providerLabel = hit?.spec.label ?? provider;
  const run = createInteractiveAgentRun({
    id: runId,
    provider,
    providerLabel,
    cwd: body.cwd,
    title: body.title?.trim() || `Interactive ${providerLabel}`,
    prompt: body.prompt,
    model: body.model,
    sessionId: body.sessionId,
    parentRunId: body.parentRunId,
  });
  const wrap = interactiveRunWrap(run.dir);
  if (body.taskId) {
    await upsertTaskAgentRun({
      taskId: body.taskId,
      runId: run.spec.id,
      status: "queued",
      provider,
      sessionId: body.sessionId ?? null,
    });
  }
  return NextResponse.json({ run: toAgentRunSummary(run), wrap }, { status: 201 });
}, "agent.runs.interactive.post");
