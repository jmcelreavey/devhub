import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fingerprint: vi.fn(), execute: vi.fn(), runs: vi.fn(), readRun: vi.fn() }));
vi.mock("@/lib/workflows/fingerprint", () => ({ worktreeFingerprint: mocks.fingerprint }));
vi.mock("@/lib/agent-runs/store", () => ({ readAgentRun: mocks.readRun, listAgentRuns: () => [] }));
vi.mock("@/lib/agent-runs/dispatch", () => ({ validateAgentCwd: (cwd: string) => cwd }));
vi.mock("@/lib/exec-external", () => ({ execExternal: mocks.execute }));
vi.mock("@/lib/tasks/task-agent-runs", async (original) => ({
  ...await original<typeof import("@/lib/tasks/task-agent-runs")>(),
  listTaskAgentRuns: mocks.runs,
}));
import { actOnWorkflow, executeWorkflowCheck, refreshWorkflowEvidence } from "./service";
import { readWorkflow, updateWorkflow } from "./store";

let notes: string;
beforeEach(() => {
  notes = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-actions-"));
  vi.stubEnv("NOTES_DIR", notes);
  mocks.fingerprint.mockResolvedValue("current");
  mocks.execute.mockResolvedValue({ stdout: "", stderr: "" });
  mocks.readRun.mockReturnValue({ spec: { id: "implement", cwd: "/checkout" } });
  mocks.runs.mockReturnValue([{ runId: "implement", role: "implement" }, { runId: "review", role: "review", status: "done", codeFingerprint: "current" }]);
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); fs.rmSync(notes, { recursive: true, force: true }); });

async function verified() {
  const { checkId } = await actOnWorkflow({ taskId: "task", revision: 0, action: "verify" });
  await executeWorkflowCheck("task", checkId!);
  await actOnWorkflow({ taskId: "task", revision: readWorkflow("task").revision, action: "review", runId: "review", verdict: "pass", findings: "No unresolved findings." });
}
async function proposal() {
  await verified();
  const { workflow } = await actOnWorkflow({ taskId: "task", revision: readWorkflow("task").revision, action: "propose", kind: "commit-push", destination: "private/main", content: "feat: keep task evidence" });
  return workflow.proposals[0].id;
}
it("consumes approvals once and keeps uncertain publication from being retried", async () => {
  const proposalId = await proposal();
  await actOnWorkflow({ taskId: "task", revision: readWorkflow("task").revision, action: "decide", proposalId, approve: true });
  await actOnWorkflow({ taskId: "task", revision: readWorkflow("task").revision, action: "begin", proposalId });
  expect(readWorkflow("task").proposals[0].state).toBe("outcome-unknown");
  await expect(actOnWorkflow({ taskId: "task", revision: readWorkflow("task").revision, action: "begin", proposalId })).rejects.toThrow("already been used");
});
it("refuses approval when the worktree changes and refresh marks evidence stale", async () => {
  const proposalId = await proposal();
  mocks.fingerprint.mockResolvedValue("changed");
  await expect(actOnWorkflow({ taskId: "task", revision: readWorkflow("task").revision, action: "decide", proposalId, approve: true })).rejects.toThrow("no longer pending");
  const refreshed = await refreshWorkflowEvidence("task");
  expect(refreshed.proposals[0].state).toBe("stale");
  expect(refreshed.stage).toBe("verify");
});
it("blocks expired, wrong-task and obsolete decisions", async () => {
  const proposalId = await proposal();
  await expect(actOnWorkflow({ taskId: "other", revision: 0, action: "decide", proposalId, approve: true })).rejects.toThrow("not found");
  await expect(actOnWorkflow({ taskId: "task", revision: 0, action: "decide", proposalId, approve: true })).rejects.toThrow("changed");
  await updateWorkflow("task", undefined, (state) => { state.proposals[0].expiresAt = new Date(0).toISOString(); return "Expired fixture"; });
  await expect(actOnWorkflow({ taskId: "task", revision: readWorkflow("task").revision, action: "decide", proposalId, approve: true })).rejects.toThrow("no longer pending");
});
it("records failed verification and refuses review", async () => {
  mocks.execute.mockRejectedValue(Object.assign(new Error("failed"), { code: 1 }));
  const { checkId } = await actOnWorkflow({ taskId: "task", revision: 0, action: "verify" });
  await executeWorkflowCheck("task", checkId!);
  expect(readWorkflow("task").checks[0]).toMatchObject({ exitCode: 1, outcome: "failed" });
  await expect(actOnWorkflow({ taskId: "task", revision: readWorkflow("task").revision, action: "review", runId: "review", verdict: "pass", findings: "done" })).rejects.toThrow("Verify this code");
});
it("does not unpause the task when a check finishes", async () => {
  const { checkId } = await actOnWorkflow({ taskId: "task", revision: 0, action: "verify" });
  await actOnWorkflow({ taskId: "task", revision: 1, action: "status", status: "paused" });
  await executeWorkflowCheck("task", checkId!);
  expect(readWorkflow("task").status).toBe("paused");
  expect(readWorkflow("task").checks[0].outcome).toBe("passed");
});
it("claims each check once even if its completion callback is repeated", async () => {
  const { checkId } = await actOnWorkflow({ taskId: "task", revision: 0, action: "verify" });
  await Promise.all([executeWorkflowCheck("task", checkId!), executeWorkflowCheck("task", checkId!)]);
  expect(mocks.execute).toHaveBeenCalledTimes(1);
});
it("recovers abandoned checks without launching them again", async () => {
  await actOnWorkflow({ taskId: "task", revision: 0, action: "verify" });
  await updateWorkflow("task", undefined, (state) => { state.checks[0].startedAt = new Date(0).toISOString(); return "Old fixture"; });
  const workflow = await refreshWorkflowEvidence("task");
  expect(workflow.checks[0].outcome).toBe("interrupted");
  expect(mocks.execute).not.toHaveBeenCalled();
});
