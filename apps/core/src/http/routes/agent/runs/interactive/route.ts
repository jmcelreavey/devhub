import type { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../../lib/api-utils";
import { httpAction } from "../../../../../lib/actions/http";
import { agentInteractive, agentInteractiveInput } from "../../../../../../../../packages/shared/actions/agents";
import { interactiveRunWrap } from "../../../../../lib/agent-runs/launch";
import { listAgentProviders } from "../../../../../lib/agent-runs/providers";
import {
  createInteractiveAgentRun,
  isValidAgentRunId,
  newAgentRunId,
  toAgentRunSummary,
} from "../../../../../lib/agent-runs/store";
import { upsertTaskAgentRun } from "../../../../../domains/tasks/task-agent-runs";
import { mapUiProviderToAgentDispatch } from "../../../../../../../../packages/shared/ui-lib/tasks/task-agent-resume";


/**
 * Register an interactive CLI session in the run history. The response's `wrap`
 * fragments go around the CLI command so the tab reports start and exit.
 */
export const POST = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, agentInteractiveInput);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  return httpAction(agentInteractive, {
    input: () => body,
    context: () => ({ execute: createInteractiveRun }),
    response: (response) => response as Response,
  })(req);
}, "agent.runs.interactive.post");

async function createInteractiveRun(body: z.output<typeof agentInteractiveInput>) {
  const runId = body.runId?.trim() || newAgentRunId();
  if (!isValidAgentRunId(runId)) {
    return Response.json({ error: "invalid runId" }, { status: 400 });
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
  return Response.json({ run: toAgentRunSummary(run), wrap }, { status: 201 });
}
