import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentRunsDir, archiveLegacyAgentRun, cancelAgentRun, countActiveAgentRuns, createAgentRun, newAgentRunId, readAgentRun, reconcileAgentRun, updateAgentRunStatus } from "./store";
import { closeSqliteDatabase, openSqliteDatabase, sqliteDatabasePath } from "../../domains/storage/sqlite";
import { appendRunEvent, readRunEvents, readRunStatus } from "./run-files";
import { claimAgentRequest, readAgentRequest, withAgentAdmission } from "./claims";

describe.each(["file", "sqlite"])("durable agent history (%s)", (backend) => {
  let root: string;
  beforeEach(() => {
    vi.stubEnv("DEVHUB_STORAGE_URL", undefined);
    root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-agent-history-"));
    vi.stubEnv("DEVHUB_AGENT_RUNS_DIR", path.join(root, "legacy"));
    vi.stubEnv("HOME", root);
    vi.stubEnv("XDG_STATE_HOME", path.join(root, "state"));
    vi.stubEnv("DEVHUB_DESKTOP", "");
    vi.stubEnv("DEVHUB_STATE_PROFILE", "");
    vi.stubEnv("DEVHUB_STORAGE_SQLITE", backend === "sqlite" ? "1" : "0");
  });
  afterEach(() => {
    if (backend === "sqlite") closeSqliteDatabase(sqliteDatabasePath());
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  });
  function create() {
    return createAgentRun({ id: newAgentRunId(), runtime: "generation", provider: "api", providerLabel: "API", bin: "generation", args: [], format: "text", cwd: root, title: "Saved result", prompt: "prompt", depth: 0, createdAt: Date.now() - 10 * 86_400_000 });
  }

  it("holds admission until asynchronous claim work finishes", async () => {
    let finish!: () => void;
    const first = withAgentAdmission(() => new Promise<void>((resolve) => { finish = resolve; }));
    try {
      await expect(withAgentAdmission(() => undefined)).rejects.toThrow("Another agent request");
    } finally { finish(); await first; }
    await expect(withAgentAdmission(() => "released")).resolves.toBe("released");
  });

  it("keeps finished runs beyond the old three-day expiry", () => {
    const run = create();
    updateAgentRunStatus(run, { state: "succeeded", finishedAt: Date.now() - 8 * 86_400_000 });
    const statusPath = path.join(run.dir, "status.json");
    const status = readRunStatus(run.dir)!;
    const oldStatus = JSON.stringify({ ...status, updatedAt: Date.now() - 8 * 86_400_000 });
    if (backend === "sqlite") openSqliteDatabase().prepare("UPDATE agent_runs SET status_json = ? WHERE id = ?").run(oldStatus, run.spec.id);
    else fs.writeFileSync(statusPath, oldStatus);
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
    run.spec.runtime = "paseo";
    run.spec.createdAt = 1;
    run.status = { ...run.status, conversationId: "agent", messageId: "devhub-run" };
    expect(reconcileAgentRun(run).status.state).toBe("queued");
    run.status = { ...run.status, state: "running", pid: 2_000_000_000 };
    expect(reconcileAgentRun(run).status.state).toBe("running");
  });

  it("uses the configured notes vault for durable storage", () => {
    vi.stubEnv("DEVHUB_AGENT_RUNS_DIR", "");
    vi.stubEnv("NOTES_DIR", path.join(root, "notes"));
    expect(agentRunsDir()).toBe(path.join(root, "notes", ".config", "agent-runs"));
  });

  it("does not rewrite unchanged reconciled status", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000_000_000);
    try {
      const run = create();
      now.mockReturnValue(1_000_000_001_000);
      const unchanged = updateAgentRunStatus(run, { state: "queued" }, { skipIfUnchanged: true });
      expect(unchanged.status.updatedAt).toBe(1_000_000_000_000);
      const changed = updateAgentRunStatus(unchanged, { state: "running" }, { skipIfUnchanged: true });
      expect(changed.status.updatedAt).toBe(1_000_000_001_000);
    } finally {
      now.mockRestore();
    }
  });

  it("recovers interrupted generation without replaying it", () => {
    const run = updateAgentRunStatus(create(), { state: "running", ownerPid: 2_000_000_000 });
    expect(reconcileAgentRun(run).status).toMatchObject({ state: "failed", error: expect.stringContaining("not replayed") });
  });

  it("does not count small generation calls against the coding-run limit", () => {
    updateAgentRunStatus(create(), { state: "running", ownerPid: process.pid });
    expect(countActiveAgentRuns()).toBe(0);
  });

  it("does not let historical AionUI runs consume Paseo capacity", () => {
    const spec = { ...create().spec, id: newAgentRunId(), runtime: "aionui" as const };
    updateAgentRunStatus(createAgentRun(spec), { state: "needs-attention" });
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

  it("pages events and keeps request claims durable", async () => {
    const run = create();
    for (let index = 0; index < 5; index++) appendRunEvent(run.dir, { type: "text", text: String(index), seq: index, ts: index });
    const first = readRunEvents(run.dir, 0, 2);
    const second = readRunEvents(run.dir, first.next, 2);
    const third = readRunEvents(run.dir, second.next, 2);
    expect([...first.events, ...second.events, ...third.events].map((event) => event.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(third).toMatchObject({ next: 5, total: 5 });
    expect(await claimAgentRequest("request", run.spec.id)).toBe(run.spec.id);
    expect(await claimAgentRequest("request", newAgentRunId())).toBe(run.spec.id);
    expect(await readAgentRequest("request")).toBe(run.spec.id);
  });
});
