import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyWorkflow, evidenceReady, invalidateEvidence, readWorkflow, updateWorkflow } from "./store";
import { getTaskAgentHandoff, listTaskAgentRuns, upsertTaskAgentRun } from "@/lib/tasks/task-agent-runs";

let notes: string;
beforeEach(() => { notes = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-workflow-")); });
afterEach(() => { fs.rmSync(notes, { recursive: true, force: true }); });
describe("durable workflow", () => {
  it("serialises concurrent updates and refuses an obsolete revision", async () => {
    const results = await Promise.allSettled([
      updateWorkflow("task", 0, (state) => { state.stage = "implement"; return "Implementation started"; }, notes),
      updateWorkflow("task", 0, (state) => { state.stage = "review"; return "Review started"; }, notes),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const restored = readWorkflow("task", notes);
    expect(restored.revision).toBe(1);
    expect(restored.events).toHaveLength(1);
  });
  it("rejects path traversal and refuses corrupt state instead of losing history", async () => {
    expect(() => readWorkflow("../escape", notes)).toThrow("Invalid task");
    await updateWorkflow("task", 0, () => "Created", notes);
    fs.writeFileSync(path.join(notes, ".config/task-workflows/task.json"), "{");
    expect(() => readWorkflow("task", notes)).toThrow();
  });
  it("does not let planning or reviews change the implementation resume target", async () => {
    await upsertTaskAgentRun({ taskId: "task", runId: "run-m1abc2-deadbeef", role: "implement", notesDir: notes });
    await upsertTaskAgentRun({ taskId: "task", runId: "run-m1abc3-cafebabe", role: "review", notesDir: notes });
    await upsertTaskAgentRun({ taskId: "task", runId: "run-m1abc4-deadcafe", role: "discuss", notesDir: notes });
    expect(listTaskAgentRuns("task", notes)).toHaveLength(3);
    expect(getTaskAgentHandoff("task", notes).latestRun?.runId).toBe("run-m1abc2-deadbeef");
  });
  it("requires checks and review for the exact code and invalidates decisions on change", () => {
    const state = emptyWorkflow("task");
    state.stage = "approve";
    state.checks.push({ id: "check", runId: "implement", fingerprint: "old", command: "npm run verify", startedAt: "", exitCode: 0, outcome: "passed" });
    state.reviews.push({ runId: "review", fingerprint: "old", verdict: "pass", findings: "Resolved", recordedAt: "" });
    state.proposals.push({ id: "proposal", runId: "implement", kind: "commit-push", fingerprint: "old", destination: "origin main", content: "fix: test", contentHash: "hash", expiresAt: new Date(Date.now() + 60000).toISOString(), state: "approved" });
    expect(evidenceReady(state, "old")).toBe(true);
    expect(evidenceReady(state, "new")).toBe(false);
    invalidateEvidence(state, "new");
    expect(state.proposals[0].state).toBe("stale");
    expect(state.stage).toBe("verify");
  });
});
