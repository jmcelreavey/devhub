import { after, NextRequest } from "next/server";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { storyboardError, storyboardJson } from "@/lib/storyboard/http";
import { askBackOrchestration, decideOrchestrationPlan, answerRepoQuestion, getOrchestration, listOrchestrationSummaries, orchestrationSummary, reconcileOrchestrations, rerunOrchestrationStep, resetTaskToTodo, retryOrchestration, setOrchestrationMode, setOrchestrationUi, startOrchestration } from "@/lib/storyboard/orchestrator";
import { OrchestratePostSchema, TaskIdSchema } from "@/lib/storyboard/schema";

export const dynamic = "force-dynamic";

/** No taskId: summaries for task rows and the Storyboard header. With one: that task's record and summary. */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const taskId = req.nextUrl.searchParams.get("taskId");
  try {
    if (!taskId) {
      const executions = await reconcileOrchestrations();
      executions.forEach((execute) => after(execute));
      return storyboardJson(listOrchestrationSummaries());
    }
    const id = TaskIdSchema.safeParse(taskId);
    if (!id.success) return storyboardJson({ error: "Invalid task ID" }, 400);
    const orchestration = getOrchestration(id.data);
    return storyboardJson({ orchestration, summary: orchestrationSummary(orchestration) });
  } catch (error) {
    return storyboardError(error);
  }
}, "storyboard.orchestrate.get");

/**
 * Start on auto (`start`), answer the missing-repo question (`answer-repo`), or
 * flip the Auto/Manual switch (`mode`).
 *
 * Start on auto. Idempotent: a repeated key replays, and a task already on auto
 * returns its existing record (200) instead of starting a second run.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, OrchestratePostSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const context = { origin: req.nextUrl.origin };
    if (parsed.data.action === "plan-decision") {
      const { orchestration, execute } = await decideOrchestrationPlan(parsed.data);
      if (execute) after(execute);
      return storyboardJson({ orchestration, summary: orchestrationSummary(orchestration) });
    }
    if (parsed.data.action === "mode") {
      const result = await setOrchestrationMode(parsed.data, context);
      return storyboardJson({ ...result, summary: orchestrationSummary(result.orchestration) });
    }
    if (parsed.data.action === "answer-repo") {
      const result = await answerRepoQuestion(parsed.data, context);
      return storyboardJson({ ...result, summary: orchestrationSummary(result.orchestration) });
    }
    if (parsed.data.action === "ui") {
      const orchestration = await setOrchestrationUi(parsed.data);
      return storyboardJson({ orchestration, summary: orchestrationSummary(orchestration) });
    }
    if (parsed.data.action === "ask-back") {
      const { orchestration, execute } = await askBackOrchestration(parsed.data);
      if (execute) after(execute);
      return storyboardJson({ orchestration, summary: orchestrationSummary(orchestration) });
    }
    if (parsed.data.action === "rerun") {
      const { orchestration, execute } = await rerunOrchestrationStep(parsed.data);
      if (execute) after(execute);
      return storyboardJson({ orchestration, summary: orchestrationSummary(orchestration) });
    }
    if (parsed.data.action === "reset") {
      return storyboardJson({ reset: await resetTaskToTodo(parsed.data) });
    }
    if (parsed.data.action === "retry") {
      const { orchestration, execute } = await retryOrchestration(parsed.data, context);
      if (execute) after(execute);
      return storyboardJson({ orchestration, summary: orchestrationSummary(orchestration) });
    }
    const result = await startOrchestration(parsed.data, context);
    return storyboardJson({ ...result, summary: orchestrationSummary(result.orchestration) }, result.created ? 201 : 200);
  } catch (error) {
    return storyboardError(error);
  }
}, "storyboard.orchestrate.post");
