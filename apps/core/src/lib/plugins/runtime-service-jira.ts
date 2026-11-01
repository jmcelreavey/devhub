import type { Task } from "../../../../../packages/shared/tasks/types.ts";
import { isTaskOpen } from "../../../../../packages/shared/tasks/types.ts";
import type { ServiceJiraRequest } from "../../../../../packages/shared/plugin-runtime";
import { jiraConnection, jiraProvider } from "../integrations/jira";
import { writeNow } from "../integrations/write-store";
import { IntegrationError } from "../integrations/types";
import type { WriteInput } from "../integrations/write-types";

export async function serviceJiraOperation(request: ServiceJiraRequest, task: Task | null, authorised: () => boolean) {
  if (!authorised()) throw new Error("Service authorisation changed");
  if (request.operation === "jira-connected") {
    try { jiraConnection("default"); return { connected: true }; }
    catch (error) {
      if (error instanceof IntegrationError && (error.kind === "auth" || error.kind === "invalid")) return { connected: false };
      throw error;
    }
  }
  if (!task || task.id !== request.taskId || task.createdAt !== request.createdAt || !isTaskOpen(task) || task.teamPickup?.handoffId !== request.handoffId || task.teamPickup.status !== "pending" || task.jiraKey !== request.jiraKey) throw new Error("The pickup or Jira issue changed");
  const input: WriteInput = { action: "issue.assign-self", provider: "jira", account: "default", ref: { provider: "jira", account: "default", kind: "issue", id: request.jiraKey } };
  const outcome = await writeNow(input, request.profile, AbortSignal.timeout(30_000), {
    source: "Plugin service pickup", provider: () => jiraProvider,
    idempotencyKey: JSON.stringify([request.taskId, request.createdAt, request.handoffId]), authorised,
  });
  if (outcome.result.state !== "succeeded") throw new Error(outcome.result.detail ?? "Jira assignment outcome is unknown");
  return { detail: outcome.result.receipt?.detail ?? outcome.result.detail ?? "Assigned" };
}
