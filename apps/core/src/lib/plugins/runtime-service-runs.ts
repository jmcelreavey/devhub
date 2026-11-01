import fs from "node:fs";
import path from "node:path";
import type { Task } from "../../../../../packages/shared/tasks/types.ts";
import { isActiveAgentRunState, readRunSpec, readRunStatus, taskScopeForDirectory } from "../agent-runs/run-files";
import { agentRunDir, agentRunsDir, cancelAgentRun, reconcileAgentRun } from "../agent-runs/store";
import { getNotesDir } from "../content/dirs";
import { cancelManagedRun, reconcileManagedRun } from "../paseo/lifecycle";
import { taskAgentRunsPath } from "../../domains/tasks/task-agent-runs";
import { assertSafePath } from "./filesystem";

interface RunRequest {
  operation: "cancel-run" | "reconcile-run";
  profile: string;
  taskId: string;
  runId: string;
  createdAt: string;
  handoffId: string;
}

export async function serviceTaskRunOperation(task: Task | null, directory: string, request: RunRequest, authorised: () => boolean) {
  if (!task || task.createdAt !== request.createdAt || task.handoff?.handoffId !== request.handoffId || task.handoff.status !== "pending") throw new Error("The task handoff changed");
  const configured = getNotesDir();
  const root = fs.existsSync(configured) ? fs.realpathSync(configured) : path.resolve(configured);
  const file = taskAgentRunsPath(task.id, root);
  assertSafePath(root, file);
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw new Error("Task runs are unavailable");
  const sidecar: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!sidecar || typeof sidecar !== "object" || !("runs" in sidecar) || !Array.isArray(sidecar.runs) || !sidecar.runs.some((entry: unknown) => !!entry && typeof entry === "object" && "runId" in entry && entry.runId === request.runId)) throw new Error("The run is not linked to this task");
  const dir = agentRunDir(request.runId);
  if (!dir) throw new Error("Invalid run id");
  assertSafePath(agentRunsDir(), path.join(dir, "spec.json"));
  assertSafePath(agentRunsDir(), path.join(dir, "status.json"));
  const spec = readRunSpec(dir);
  const status = readRunStatus(dir);
  const run = spec && status && spec.id === request.runId ? { dir, spec, status } : null;
  const expected = taskScopeForDirectory(request.profile, directory, task.id, task.createdAt);
  const scope = run?.spec.activity?.taskScope;
  if (!run || run.spec.activity?.taskId !== task.id || !expected || !scope || scope.profile !== expected.profile || scope.directoryIdentity !== expected.directoryIdentity || scope.taskCreatedAt !== expected.taskCreatedAt) throw new Error("The run is not scoped to this task");
  if (!authorised()) throw new Error("Service is not authorised");
  if (!isActiveAgentRunState(run.status.state)) return { state: run.status.state };
  const managed = run.spec.runtime === "paseo" || run.spec.runtime === "aionui";
  if (request.operation === "cancel-run") {
    if (run.spec.runtime === "generation" || run.spec.bin === "interactive") throw new Error("Stop this agent in its own window");
    const result = managed ? await cancelManagedRun(run) : cancelAgentRun(run);
    return { state: result.run.status.state };
  }
  const current = managed ? await reconcileManagedRun(run) : reconcileAgentRun(run);
  return { state: current.status.state };
}
