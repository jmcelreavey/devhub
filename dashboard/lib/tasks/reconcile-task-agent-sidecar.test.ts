import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAgentRun,
  readAgentRun,
  updateAgentRunStatus,
  type AgentRun,
} from "@/lib/agent-runs/store";
import type { AgentRunSpec } from "@/lib/agent-runs/run-files";
import { getTaskAgentRuns, upsertTaskAgentRun } from "@/lib/tasks/task-agent-runs";
import { reconcileTaskAgentRunSidecar } from "@/lib/tasks/reconcile-task-agent-sidecar";

// Fake ids: real ones from the vault would let a late background write find the real task.
const TASK_ID = "00000000-0000-4000-8000-00000000c0de";
const RUN_ID = "run-test0001-0000c0de";

function minimalSpec(id: string): AgentRunSpec {
  return {
    id,
    provider: "opencode",
    providerLabel: "OpenCode",
    bin: "/usr/bin/true",
    args: [],
    format: "claude-stream-json",
    cwd: "/tmp",
    title: "test",
    prompt: "do thing",
    depth: 0,
    createdAt: Date.now(),
  };
}

describe("task agent sidecar sync", () => {
  let notesDir: string;
  let runsRoot: string;
  let prevRunsEnv: string | undefined;
  let prevNotesEnv: string | undefined;

  beforeEach(() => {
    notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-tar-sync-"));
    runsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-agent-runs-"));
    prevRunsEnv = process.env.DEVHUB_AGENT_RUNS_DIR;
    prevNotesEnv = process.env.NOTES_DIR;
    process.env.DEVHUB_AGENT_RUNS_DIR = runsRoot;
    process.env.NOTES_DIR = notesDir;
  });

  afterEach(() => {
    if (prevRunsEnv === undefined) delete process.env.DEVHUB_AGENT_RUNS_DIR;
    else process.env.DEVHUB_AGENT_RUNS_DIR = prevRunsEnv;
    if (prevNotesEnv === undefined) delete process.env.NOTES_DIR;
    else process.env.NOTES_DIR = prevNotesEnv;
    fs.rmSync(notesDir, { recursive: true, force: true });
    fs.rmSync(runsRoot, { recursive: true, force: true });
  });

  async function linkQueuedSidecar(): Promise<AgentRun> {
    const run = createAgentRun(minimalSpec(RUN_ID));
    await upsertTaskAgentRun({
      taskId: TASK_ID,
      runId: RUN_ID,
      status: "queued",
      notesDir,
    });
    return run;
  }

  it("readAgentRun heals sidecar when status.json is already failed", async () => {
    const run = await linkQueuedSidecar();
    updateAgentRunStatus(run, {
      state: "failed",
      finishedAt: Date.now(),
      error: "OpenCode exited with code 1",
    });
    await upsertTaskAgentRun({
      taskId: TASK_ID,
      runId: RUN_ID,
      status: "queued",
      notesDir,
    });

    readAgentRun(RUN_ID);

    await vi.waitFor(() => {
      expect(getTaskAgentRuns(TASK_ID, notesDir).runs[0]?.status).toBe("failed");
    });
  });

  it("reconcileTaskAgentRunSidecar maps cancelled agent runs to abandoned", async () => {
    const run = await linkQueuedSidecar();
    updateAgentRunStatus(run, {
      state: "cancelled",
      finishedAt: Date.now(),
      error: "Cancelled before it started.",
    });

    const file = await reconcileTaskAgentRunSidecar(TASK_ID, notesDir);
    expect(file.runs[0]?.status).toBe("abandoned");
  });

  it("reconcileTaskAgentRunSidecar maps succeeded agent runs to done", async () => {
    const run = await linkQueuedSidecar();
    updateAgentRunStatus(run, { state: "running", startedAt: Date.now(), pid: process.pid });
    updateAgentRunStatus(run, { state: "succeeded", finishedAt: Date.now() });
    await upsertTaskAgentRun({
      taskId: TASK_ID,
      runId: RUN_ID,
      status: "running",
      notesDir,
    });

    const file = await reconcileTaskAgentRunSidecar(TASK_ID, notesDir);
    expect(file.runs[0]?.status).toBe("done");
  });

  it("reconcile marks sidecar abandoned when agent run dir is gone", async () => {
    await upsertTaskAgentRun({
      taskId: TASK_ID,
      runId: RUN_ID,
      status: "running",
      notesDir,
    });

    const file = await reconcileTaskAgentRunSidecar(TASK_ID, notesDir);
    expect(file.runs[0]?.status).toBe("abandoned");
  });
});
