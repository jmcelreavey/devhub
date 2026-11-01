import fs from "node:fs";
import path from "node:path";
import { findTask, invalidateTaskCache } from "../../domains/tasks/store";
import { withTaskDirectory } from "../../domains/tasks/profile-context";
import { readTaskNoteMarkdown, resolveTaskNotePath } from "../../domains/tasks/implement-ready-gather";
import { isTaskOpen, isTaskOwnershipBlocked } from "../../../../../packages/shared/tasks/types.ts";
import type { ServiceTaskDispatchRequest } from "../../../../../packages/shared/plugin-runtime";
import { getNotesDir } from "../content/dirs";
import { decideOrchestrationPlan, retryOrchestration } from "../storyboard/orchestrator";
import { orchestrationsDir, readOrchestration, withOrchestrationAuthorisation } from "../storyboard/orchestration-store";
import { assertSafePath } from "./filesystem";
import { servicePlanFingerprint } from "./runtime-service-workflow";

export async function serviceTaskDispatch(request: ServiceTaskDispatchRequest, root: string, directory: string, current: () => boolean): Promise<null> {
  const configured = getNotesDir();
  const notes = fs.existsSync(configured) ? fs.realpathSync(configured) : path.resolve(configured);
  const valid = () => {
    if (!current()) return false;
    const items = path.join(directory, "items");
    assertSafePath(directory, path.join(items, request.taskId + ".json"));
    if (fs.existsSync(items)) for (const name of fs.readdirSync(items)) {
      if (name.endsWith(".json") && !name.endsWith(".local.json")) assertSafePath(directory, path.join(items, name));
    }
    invalidateTaskCache(directory);
    const task = findTask(directory, request.taskId);
    if (!task || task.id !== request.taskId || task.createdAt !== request.createdAt || !isTaskOpen(task) || isTaskOwnershipBlocked(task)) return false;
    assertSafePath(notes, path.join(orchestrationsDir(notes), request.taskId + ".json"));
    if (request.operation === "plan-approve") {
      const record = readOrchestration(request.taskId, notes);
      if (!record) return false;
      const notePath = resolveTaskNotePath(task, record.taskDate);
      assertSafePath(notes, path.resolve(notes, notePath + ".json"));
      const markdown = readTaskNoteMarkdown(notePath);
      if (markdown === null || servicePlanFingerprint(request.planRunId, markdown) !== request.fingerprint) return false;
    }
    return current();
  };
  return withTaskDirectory(root, directory, () => withOrchestrationAuthorisation(valid, async () => {
    if (!valid()) throw new Error("The task, plan or service authorisation changed");
    const record = readOrchestration(request.taskId, notes);
    if (!record) throw new Error("The task is not on auto");
    const result = request.operation === "plan-approve"
      ? await decideOrchestrationPlan({ action: "plan-decision", taskId: request.taskId, planRunId: request.planRunId, decision: "approve", idempotencyKey: request.requestId }, undefined, notes)
      : await retryOrchestration({ action: "retry", taskId: request.taskId, idempotencyKey: request.requestId }, { origin: record.auto?.origin ?? new URL(process.env.DEVHUB_BASE_URL || `http://${process.env.DEVHUB_BIND_HOST || "localhost"}:${process.env.PORT || "1337"}`).origin }, undefined, notes);
    if (!valid()) throw new Error("The task, plan or service authorisation changed");
    await result.execute?.();
    return null;
  }));
}
