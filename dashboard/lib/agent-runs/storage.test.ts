import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentRunsDir, archiveLegacyAgentRun, cancelAgentRun, countActiveAgentRuns, createAgentRun, newAgentRunId, readAgentRun, reconcileAgentRun, updateAgentRunStatus } from "./store";

describe("durable agent history", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-agent-history-"));
    vi.stubEnv("DEVHUB_AGENT_RUNS_DIR", path.join(root, "legacy"));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  });
  function create() {
    return createAgentRun({ id: newAgentRunId(), runtime: "generation", provider: "api", providerLabel: "API", bin: "generation", args: [], format: "text", cwd: root, title: "Saved result", prompt: "prompt", depth: 0, createdAt: Date.now() - 10 * 86_400_000 });
  }

  it("keeps finished runs beyond the old three-day expiry", () => {
    const run = create();
    updateAgentRunStatus(run, { state: "succeeded", finishedAt: Date.now() - 8 * 86_400_000 });
    const statusPath = path.join(run.dir, "status.json");
    const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
    fs.writeFileSync(statusPath, JSON.stringify({ ...status, updatedAt: Date.now() - 8 * 86_400_000 }));
    create();
    expect(readAgentRun(run.spec.id)?.status.state).toBe("succeeded");
  });

  it("archives completed records without moving or overwriting their source", () => {
    const run = updateAgentRunStatus(create(), { state: "succeeded", resultText: "Existing answer" });
    const target = path.join(root, "durable");
    const archived = archiveLegacyAgentRun(run, target);
    expect(archived.dir).toBe(path.join(target, run.spec.id));
    expect(archived.status.resultText).toBe("Existing answer");
    expect(fs.existsSync(run.dir)).toBe(true);
    expect(archiveLegacyAgentRun(run, target).status).toEqual(archived.status);
  });

  it("leaves active legacy work in the directory its runner is updating", () => {
    const run = create();
    expect(archiveLegacyAgentRun(run, path.join(root, "durable"))).toBe(run);
  });

  it("does not apply terminal expiry or dead-PID rules to managed work", () => {
    const run = create();
    run.spec.runtime = "aionui";
    run.spec.createdAt = 1;
    expect(reconcileAgentRun(run).status.state).toBe("queued");
    run.status = { ...run.status, state: "running", pid: 2_000_000_000 };
    expect(reconcileAgentRun(run).status.state).toBe("running");
  });

  it("uses the configured notes vault for durable storage", () => {
    vi.stubEnv("DEVHUB_AGENT_RUNS_DIR", "");
    vi.stubEnv("NOTES_DIR", path.join(root, "notes"));
    expect(agentRunsDir()).toBe(path.join(root, "notes", ".config", "agent-runs"));
  });

  it("recovers interrupted generation without replaying it", () => {
    const run = updateAgentRunStatus(create(), { state: "running", ownerPid: 2_000_000_000 });
    expect(reconcileAgentRun(run).status).toMatchObject({ state: "failed", error: expect.stringContaining("not replayed") });
  });

  it("does not count small generation calls against the coding-run limit", () => {
    updateAgentRunStatus(create(), { state: "running", ownerPid: process.pid });
    expect(countActiveAgentRuns()).toBe(0);
  });

  it("never signals the dashboard process to cancel a generation", () => {
    const run = updateAgentRunStatus(create(), { state: "running", ownerPid: process.pid, pid: process.pid });
    const kill = vi.spyOn(process, "kill");
    try {
      expect(() => cancelAgentRun(run)).toThrow("owning runtime");
      expect(kill).not.toHaveBeenCalled();
    } finally { kill.mockRestore(); }
  });
});
