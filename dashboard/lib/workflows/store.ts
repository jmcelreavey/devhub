import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { writeAtomic } from "@/lib/atomic-write";
import { withPluginMutationLock } from "@/lib/plugins/lock";
import { getNotesDir } from "@/lib/notes/dir";
import { currentTaskNode, loadTaskIndex } from "@/lib/tasks/task-index";
import { isValidTaskAgentTaskId, taskRunRole } from "@/lib/tasks/task-agent-runs";
import type { TaskWorkflow } from "./types";
import { WorkflowSchema } from "./schema";
import type { AgentRunSpec, AgentRunStatus } from "@/lib/agent-runs/run-files";

export function emptyWorkflow(taskId: string): TaskWorkflow {
  return { version: 1, taskId, revision: 0, stage: "plan", status: "active", checks: [], reviews: [], proposals: [], events: [], seenRevision: 0 };
}
function workflowPath(taskId: string, notesDir: string): string {
  if (!isValidTaskAgentTaskId(taskId)) throw new Error("Invalid task ID");
  return path.join(notesDir, ".config", "task-workflows", taskId + ".json");
}
export function readWorkflow(taskId: string, notesDir = getNotesDir()): TaskWorkflow {
  try {
    const value = WorkflowSchema.parse(JSON.parse(fs.readFileSync(workflowPath(taskId, notesDir), "utf8")));
    if (value.version !== 1 || value.taskId !== taskId || !Array.isArray(value.events)) throw new Error("Invalid workflow file");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyWorkflow(taskId);
    throw error;
  }
}
export function listWorkflows(notesDir = getNotesDir()): TaskWorkflow[] {
  const dir = path.join(notesDir, ".config", "task-workflows");
  let names: string[];
  try { names = fs.readdirSync(dir); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return names.filter((name) => name.endsWith(".json")).map((name) => readWorkflow(name.slice(0, -5), notesDir));
}

export async function recordWorkflowRun(spec: AgentRunSpec, status: AgentRunStatus): Promise<void> {
  const linkedId = spec.activity?.taskId;
  if (!linkedId) return;
  const taskId = currentTaskNode(loadTaskIndex(), linkedId)?.task.id ?? linkedId;
  const role = taskRunRole(spec.activity?.action);
  await updateWorkflow(taskId, undefined, (state) => {
    state.runStates ??= {};
    const previous = state.runStates[spec.id];
    if (previous && previous.at >= status.updatedAt) return;
    const newest = Math.max(0, ...Object.values(state.runStates).map((item) => item.at));
    state.runStates[spec.id] = { state: status.state, at: status.updatedAt };
    if (status.updatedAt < newest) return role + " run: " + status.state;
    if (previous?.state === status.state) return null;
    if (role === "discuss" || ["paused", "complete", "abandoned"].includes(state.status)) return role + " run: " + status.state;
    if (["queued", "starting", "running"].includes(status.state)) {
      if (role !== "review") state.stage = role;
      state.status = "active";
    } else {
      state.status = status.state === "failed" ? "blocked" : "waiting-user";
      if (role === "implement") state.stage = "verify";
    }
    return role + " run: " + status.state;
  });
}

export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
/** Persist the event and its state together, so recovery never replays half a transition. */
export async function updateWorkflow(taskId: string, revision: number | undefined, change: (state: TaskWorkflow) => string | null | void, notesDir = getNotesDir()): Promise<TaskWorkflow> {
  const file = workflowPath(taskId, notesDir);
  return withPluginMutationLock(path.join(path.dirname(file), ".locks", taskId), async () => {
    const state = readWorkflow(taskId, notesDir);
    if (revision !== undefined && state.revision !== revision) throw new Error("Workflow changed. Refresh before trying again.");
    const summary = change(state);
    if (summary === undefined) return state;
    // A newer observation of the same state advances recovery without another alert.
    if (summary !== null) {
      state.revision += 1;
      state.events.push({ id: randomUUID(), at: new Date().toISOString(), summary });
    }
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeAtomic(file, JSON.stringify(state, null, 2));
    return state;
  });
}
export function invalidateEvidence(state: TaskWorkflow, fingerprint: string): void {
  for (const check of state.checks) if (check.fingerprint !== fingerprint) check.stale = true;
  for (const review of state.reviews) if (review.fingerprint !== fingerprint) review.stale = true;
  for (const proposal of state.proposals) {
    if (["pending", "approved"].includes(proposal.state) && (proposal.fingerprint !== fingerprint || Date.parse(proposal.expiresAt) <= Date.now())) proposal.state = "stale";
  }
  if ((state.checks.at(-1) && state.checks.at(-1)?.fingerprint !== fingerprint) || (state.reviews.at(-1) && state.reviews.at(-1)?.fingerprint !== fingerprint)) {
    if (["review", "approve", "draft-pr"].includes(state.stage)) {
      state.stage = "verify";
      state.status = "blocked";
    }
  }
}
export function evidenceReady(state: TaskWorkflow, fingerprint: string): boolean {
  const check = state.checks.at(-1);
  const review = state.reviews.at(-1);
  return check?.outcome === "passed" && !check.stale && check.fingerprint === fingerprint && review?.verdict === "pass" && !review.stale && review.fingerprint === fingerprint;
}
