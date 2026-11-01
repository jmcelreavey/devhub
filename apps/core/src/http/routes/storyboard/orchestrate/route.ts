import { runBackground } from "@devhub/core/http/background";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { httpAction } from "../../../../lib/actions/http";
import { storyboardAnswerRepo, storyboardAskBack, storyboardAutoRetry, storyboardAutoStatus, storyboardPlanDecision, storyboardRerun, storyboardReset, storyboardSetMode, storyboardSetUi, storyboardStartAuto, storyboardSummaries } from "../../../../../../../packages/shared/actions/storyboard";
import { storyboardError, storyboardJson } from "../../../../lib/storyboard/http";
import { askBackOrchestration, decideOrchestrationPlan, answerRepoQuestion, getOrchestration, listOrchestrationSummaries, orchestrationSummary, reconcileOrchestrations, rerunOrchestrationStep, resetTaskToTodo, retryOrchestration, setOrchestrationMode, setOrchestrationUi, startOrchestration } from "../../../../lib/storyboard/orchestrator";
import { OrchestratePostSchema, TaskIdSchema } from "../../../../lib/storyboard/schema";


/** No taskId: summaries for task rows and the Storyboard header. With one: that task's record and summary. */
export const GET = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const taskId = new URL(req.url).searchParams.get("taskId");
  try {
    if (!taskId) {
      return httpAction(storyboardSummaries, {
        input: () => ({}),
        context: () => ({ read: async () => {
          try {
            const executions = await reconcileOrchestrations();
            executions.forEach((execute) => runBackground("storyboard/orchestrate", execute));
            return { status: 200, body: listOrchestrationSummaries() };
          } catch (error) {
            const response = storyboardError(error);
            return { status: response.status, body: await response.json() };
          }
        } }),
        response: ({ status, body }) => storyboardJson(body, status),
      })(req);
    }
    const id = TaskIdSchema.safeParse(taskId);
    if (!id.success) return storyboardJson({ error: "Invalid task ID" }, 400);
    return httpAction(storyboardAutoStatus, {
      input: () => ({ taskId: id.data }),
      context: () => ({ read: async (task) => {
        try {
          const orchestration = getOrchestration(task);
          return { status: 200, body: { orchestration, summary: orchestrationSummary(orchestration) } };
        } catch (error) {
          const response = storyboardError(error);
          return { status: response.status, body: await response.json() };
        }
      } }),
      response: ({ status, body }) => storyboardJson(body, status),
    })(req);
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
export const POST = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, OrchestratePostSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const context = { origin: new URL(req.url).origin };
    if (parsed.data.action === "plan-decision") {
      const decision = parsed.data;
      return httpAction(storyboardPlanDecision, {
        input: () => decision,
        context: () => ({ decide: async (input) => {
          try {
            const { orchestration, execute } = await decideOrchestrationPlan(input);
            if (execute) runBackground("storyboard/orchestrate", execute);
            return { status: 200, body: { orchestration, summary: orchestrationSummary(orchestration) } };
          } catch (error) {
            const response = storyboardError(error);
            return { status: response.status, body: await response.json() };
          }
        } }),
        response: ({ status, body }) => storyboardJson(body, status),
      })(req);
    }
    if (parsed.data.action === "mode") {
      const mode = parsed.data;
      return httpAction(storyboardSetMode, {
        input: () => ({ taskId: mode.taskId, mode: mode.mode }),
        context: () => ({ set: async () => {
          try {
            const result = await setOrchestrationMode(mode, context);
            return { status: 200, body: { ...result, summary: orchestrationSummary(result.orchestration) } };
          } catch (error) {
            const response = storyboardError(error);
            return { status: response.status, body: await response.json() };
          }
        } }),
        response: ({ status, body }) => storyboardJson(body, status),
      })(req);
    }
    if (parsed.data.action === "answer-repo") {
      const answer = parsed.data;
      return httpAction(storyboardAnswerRepo, {
        input: () => ({ taskId: answer.taskId, taskDate: answer.taskDate, cwd: answer.cwd }),
        context: () => ({ answer: async () => {
          try {
            const result = await answerRepoQuestion(answer, context);
            return { status: 200, body: { ...result, summary: orchestrationSummary(result.orchestration) } };
          } catch (error) {
            const response = storyboardError(error);
            return { status: response.status, body: await response.json() };
          }
        } }),
        response: ({ status, body }) => storyboardJson(body, status),
      })(req);
    }
    if (parsed.data.action === "ui") {
      const selection = parsed.data;
      return httpAction(storyboardSetUi, {
        input: () => ({ taskId: selection.taskId, ui: selection.ui === null ? "auto" : selection.ui ? "yes" : "no" }),
        context: () => ({ set: async ({ ui }) => {
          try {
            const orchestration = await setOrchestrationUi({ ...selection, ui });
            return { status: 200, body: { orchestration, summary: orchestrationSummary(orchestration) } };
          } catch (error) {
            const response = storyboardError(error);
            return { status: response.status, body: await response.json() };
          }
        } }),
        response: ({ status, body }) => storyboardJson(body, status),
      })(req);
    }
    if (parsed.data.action === "ask-back") {
      const question = parsed.data;
      return httpAction(storyboardAskBack, {
        input: () => question,
        context: () => ({ ask: async (input) => {
          try {
            const { orchestration, execute } = await askBackOrchestration(input);
            if (execute) runBackground("storyboard/orchestrate", execute);
            return { status: 200, body: { orchestration, summary: orchestrationSummary(orchestration) } };
          } catch (error) {
            const response = storyboardError(error);
            return { status: response.status, body: await response.json() };
          }
        } }),
        response: ({ status, body }) => storyboardJson(body, status),
      })(req);
    }
    if (parsed.data.action === "rerun") {
      const rerun = parsed.data;
      return httpAction(storyboardRerun, {
        input: () => rerun,
        context: () => ({ rerun: async () => {
          try {
            const { orchestration, execute } = await rerunOrchestrationStep(rerun);
            if (execute) runBackground("storyboard/orchestrate", execute);
            return { status: 200, body: { orchestration, summary: orchestrationSummary(orchestration) } };
          } catch (error) {
            const response = storyboardError(error);
            return { status: response.status, body: await response.json() };
          }
        } }),
        response: ({ status, body }) => storyboardJson(body, status),
      })(req);
    }
    if (parsed.data.action === "reset") {
      const reset = parsed.data;
      return httpAction(storyboardReset, {
        input: () => ({ taskId: reset.taskId, discardWork: reset.discardWork, confirm: true }),
        context: () => ({ reset: async () => {
          try {
            return { status: 200, body: { reset: await resetTaskToTodo(reset) } };
          } catch (error) {
            const response = storyboardError(error);
            return { status: response.status, body: await response.json() };
          }
        } }),
        response: ({ status, body }) => storyboardJson(body, status),
      })(req);
    }
    if (parsed.data.action === "retry") {
      const retry = parsed.data;
      return httpAction(storyboardAutoRetry, {
        input: () => ({ taskId: retry.taskId }),
        context: () => ({ retry: async () => {
          try {
            const { orchestration, execute } = await retryOrchestration(retry, context);
            if (execute) runBackground("storyboard/orchestrate", execute);
            return { status: 200, body: { orchestration, summary: orchestrationSummary(orchestration) } };
          } catch (error) {
            const response = storyboardError(error);
            return { status: response.status, body: await response.json() };
          }
        } }),
        response: ({ status, body }) => storyboardJson(body, status),
      })(req);
    }
    const start = parsed.data;
    return httpAction(storyboardStartAuto, {
      input: () => ({ taskId: start.taskId, taskDate: start.taskDate, pauseAfterPlan: start.pauseAfterPlan, createPr: start.createPr }),
      context: () => ({ start: async () => {
        try {
          const result = await startOrchestration(start, context);
          return { status: result.created ? 201 : 200, body: { ...result, summary: orchestrationSummary(result.orchestration) } };
        } catch (error) {
          const response = storyboardError(error);
          return { status: response.status, body: await response.json() };
        }
      } }),
      response: ({ status, body }) => storyboardJson(body, status),
    })(req);
  } catch (error) {
    return storyboardError(error);
  }
}, "storyboard.orchestrate.post");
