import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getTaskAgentHandoff,
  getTaskAgentRuns,
  listTaskAgentRuns,
  lookupTaskIdForRun,
  mapAgentRunStateToTaskStatus,
  mergeHandoff,
  patchTaskAgentRun,
  relinkTaskAgentRuns,
  setTaskAgentHandoff,
  syncTaskAgentRunFromAgentState,
  upsertTaskAgentRun,
} from "@/lib/tasks/task-agent-runs";

const TASK_ID = "fe2f9c59-9533-40ba-a556-0965f5441bc8";
const RUN_A = "run-m1abc2-deadbeef";
const RUN_B = "run-m1abc3-cafebabe";

describe("mergeHandoff", () => {
  it("replaces by default", () => {
    expect(mergeHandoff("old", "new")).toEqual({ handoff: "new", changed: true });
    expect(mergeHandoff("same", "same")).toEqual({ handoff: "same", changed: false });
  });

  it("appends with a blank line and skips duplicate chunks", () => {
    expect(mergeHandoff("## Done\nA", "## Next\nB", "append")).toEqual({
      handoff: "## Done\nA\n\n## Next\nB",
      changed: true,
    });
    expect(mergeHandoff("## Done\nA\n\n## Next\nB", "## Next\nB", "append")).toEqual({
      handoff: "## Done\nA\n\n## Next\nB",
      changed: false,
    });
    expect(mergeHandoff("", "only", "append")).toEqual({ handoff: "only", changed: true });
  });
});

describe("mapAgentRunStateToTaskStatus", () => {
  it("maps agent lifecycle onto sidecar statuses", () => {
    expect(mapAgentRunStateToTaskStatus("queued")).toBe("queued");
    expect(mapAgentRunStateToTaskStatus("running")).toBe("running");
    expect(mapAgentRunStateToTaskStatus("succeeded")).toBe("done");
    expect(mapAgentRunStateToTaskStatus("failed")).toBe("failed");
    expect(mapAgentRunStateToTaskStatus("cancelled")).toBe("abandoned");
  });
});

describe("task-agent-runs persistence", () => {
  let notesDir: string;

  beforeEach(() => {
    notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-tar-"));
  });

  afterEach(() => {
    fs.rmSync(notesDir, { recursive: true, force: true });
  });

  it("upserts runs, updates status, and indexes runId → taskId", async () => {
    const created = await upsertTaskAgentRun({
      taskId: TASK_ID,
      runId: RUN_A,
      provider: "claude",
      status: "queued",
      notesDir,
    });
    expect(created.runs).toHaveLength(1);
    expect(created.runs[0]?.runId).toBe(RUN_A);
    expect(created.runs[0]?.status).toBe("queued");
    expect(lookupTaskIdForRun(RUN_A, notesDir)).toBe(TASK_ID);

    const updated = await upsertTaskAgentRun({
      taskId: TASK_ID,
      runId: RUN_A,
      status: "running",
      sessionId: "sess-1",
      branch: "feat/x",
      notesDir,
    });
    expect(updated.runs).toHaveLength(1);
    expect(updated.runs[0]?.status).toBe("running");
    expect(updated.runs[0]?.sessionId).toBe("sess-1");
    expect(updated.runs[0]?.branch).toBe("feat/x");

    await upsertTaskAgentRun({
      taskId: TASK_ID,
      runId: RUN_B,
      status: "paused",
      provider: "cursor",
      notesDir,
    });
    expect(listTaskAgentRuns(TASK_ID, notesDir)).toHaveLength(2);
  });

  it("setHandoff replace and append; get returns latest run", async () => {
    await upsertTaskAgentRun({ taskId: TASK_ID, runId: RUN_A, status: "running", notesDir });
    await setTaskAgentHandoff(TASK_ID, "## Handoff\nStarted.", { notesDir });
    let file = getTaskAgentRuns(TASK_ID, notesDir);
    expect(file.handoff).toBe("## Handoff\nStarted.");
    expect(file.handoffUpdatedAt).toBeTruthy();

    await setTaskAgentHandoff(TASK_ID, "Paused at verify.", { mode: "append", notesDir });
    file = getTaskAgentRuns(TASK_ID, notesDir);
    expect(file.handoff).toContain("## Handoff\nStarted.");
    expect(file.handoff).toContain("Paused at verify.");

    const view = getTaskAgentHandoff(TASK_ID, notesDir);
    expect(view.latestRun?.runId).toBe(RUN_A);
    expect(view.handoff).toBe(file.handoff);
  });

  it("upsert can set handoff in the same write", async () => {
    const file = await upsertTaskAgentRun({
      taskId: TASK_ID,
      runId: RUN_A,
      status: "paused",
      handoff: "## Stopped\nEOD.",
      notesDir,
    });
    expect(file.handoff).toBe("## Stopped\nEOD.");
    expect(file.runs[0]?.status).toBe("paused");
  });

  it("syncTaskAgentRunFromAgentState updates linked runs only", async () => {
    await upsertTaskAgentRun({ taskId: TASK_ID, runId: RUN_A, status: "running", notesDir });
    const synced = await syncTaskAgentRunFromAgentState(RUN_A, "succeeded", {
      sessionId: "s2",
      notesDir,
    });
    expect(synced?.runs[0]?.status).toBe("done");
    expect(synced?.runs[0]?.sessionId).toBe("s2");

    const orphan = await syncTaskAgentRunFromAgentState(RUN_B, "failed", { notesDir });
    expect(orphan).toBeNull();
  });

  it("does not bump updatedAt when a sync changes nothing", async () => {
    await upsertTaskAgentRun({ taskId: TASK_ID, runId: RUN_A, status: "running", notesDir });
    const done = await syncTaskAgentRunFromAgentState(RUN_A, "succeeded", { notesDir });
    const stamp = done?.runs[0]?.updatedAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const again = await syncTaskAgentRunFromAgentState(RUN_A, "succeeded", { notesDir });
    expect(again?.runs[0]?.updatedAt).toBe(stamp);
  });

  it("clears optional fields when set to null", async () => {
    await upsertTaskAgentRun({
      taskId: TASK_ID,
      runId: RUN_A,
      prUrl: "https://github.com/acme/app/pull/1",
      branch: "feat/x",
      notesDir,
    });
    const cleared = await upsertTaskAgentRun({
      taskId: TASK_ID,
      runId: RUN_A,
      prUrl: null,
      branch: null,
      notesDir,
    });
    expect(cleared.runs[0]?.prUrl).toBeUndefined();
    expect(cleared.runs[0]?.branch).toBeUndefined();
  });

  it("patches watcher fields without bumping updatedAt, and deletes undefined keys", async () => {
    await upsertTaskAgentRun({ taskId: TASK_ID, runId: RUN_A, status: "done", notesDir });
    const before = listTaskAgentRuns(TASK_ID, notesDir)[0]!.updatedAt;
    const attention = { kind: "ci-failing" as const, summary: "Failing checks: lint", detectedAt: "t", key: "k" };
    const patched = await patchTaskAgentRun(TASK_ID, RUN_A, { prState: "open", attention }, notesDir);
    expect(patched?.attention?.summary).toBe("Failing checks: lint");
    expect(patched?.updatedAt).toBe(before);
    const cleared = await patchTaskAgentRun(TASK_ID, RUN_A, { attention: undefined }, notesDir);
    expect(cleared?.attention).toBeUndefined();
    expect(await patchTaskAgentRun(TASK_ID, RUN_B, { prState: "open" }, notesDir)).toBeNull();
  });

  it("relinks run history to the rolled-over task id", async () => {
    const NEW_ID = "0b5c1f7e-1111-4222-8333-444455556666";
    await upsertTaskAgentRun({ taskId: TASK_ID, runId: RUN_A, status: "paused", handoff: "## Done\nA", notesDir });
    expect(await relinkTaskAgentRuns(TASK_ID, NEW_ID, notesDir)).toBe(true);
    expect(listTaskAgentRuns(TASK_ID, notesDir)).toEqual([]);
    expect(listTaskAgentRuns(NEW_ID, notesDir).map((r) => r.runId)).toEqual([RUN_A]);
    expect(getTaskAgentRuns(NEW_ID, notesDir).handoff).toBe("## Done\nA");
    expect(lookupTaskIdForRun(RUN_A, notesDir)).toBe(NEW_ID);
    // Nothing to move the second time.
    expect(await relinkTaskAgentRuns(TASK_ID, NEW_ID, notesDir)).toBe(false);
  });

  it("rejects path-traversal task ids", async () => {
    await expect(upsertTaskAgentRun({ taskId: "../evil", runId: RUN_A, notesDir })).rejects.toThrow(
      /Invalid task id/,
    );
  });
});
