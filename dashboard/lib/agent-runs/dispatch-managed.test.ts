import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("node:os", async () => (await import("@/lib/test-home")).isolatedOs());

const paseo = vi.hoisted(() => ({ startPaseoAgent: vi.fn() }));
const providers = vi.hoisted(() => ({ listPaseoProviders: vi.fn() }));
vi.mock("@/lib/paseo/providers", () => providers);
vi.mock("@/lib/paseo/dispatch", () => paseo);
vi.mock("@/lib/paseo/managed", () => ({ preferredPaseoProvider: () => "claude" }));
vi.mock("@/lib/agent-runs/git", () => ({ gitHead: async () => "base-sha", createRunWorktree: vi.fn() }));
vi.mock("@/lib/tasks/task-agent-runs", () => ({ upsertTaskAgentRun: vi.fn(async () => undefined), syncTaskAgentRunFromAgentState: vi.fn(async () => undefined) }));
vi.mock("@/lib/tasks/run-snapshot", () => ({ recordRunSnapshot: vi.fn(async () => false) }));
import { dispatchAgentRun } from "./dispatch";
import { listAgentRuns, updateAgentRunStatus } from "./store";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.homedir(), ".devhub-dispatch-test-"));
  vi.stubEnv("DEVHUB_AGENT_RUNS_DIR", path.join(root, "runs"));
  vi.stubEnv("NOTES_DIR", path.join(root, "notes"));
  vi.stubEnv("DEVHUB_AGENT_ALLOWED_ROOTS", root);
  vi.stubEnv("DEVHUB_AGENT_MAX_RUNS", "6");
  vi.clearAllMocks();
  providers.listPaseoProviders.mockResolvedValue([{ id: "claude", ready: true, label: "Claude", models: ["haiku"] }]);
  paseo.startPaseoAgent.mockImplementation(async ({ run, resumeAgentId, onSubmission }) => {
    onSubmission(`devhub-${run.spec.id}`);
    return { agentId: resumeAgentId ?? "agent-1", messageId: `devhub-${run.spec.id}` };
  });
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
const input = () => ({ provider: "claude", model: "haiku", prompt: "Synthetic test", cwd: root, depth: 0, worktree: false, requestId: "one-action" });

describe("durable Paseo dispatch", () => {
  it("claims concurrent retries once and returns the saved run after capacity fills", async () => {
    vi.stubEnv("DEVHUB_AGENT_MAX_RUNS", "1");
    const [first, retry] = await Promise.all([dispatchAgentRun(input()), dispatchAgentRun(input())]);
    expect(first.spec.id).toBe(retry.spec.id);
    expect(paseo.startPaseoAgent).toHaveBeenCalledTimes(1);
    expect(listAgentRuns()).toHaveLength(1);
    expect((await dispatchAgentRun(input())).spec.id).toBe(first.spec.id);
    expect(first.spec).toMatchObject({ runtime: "paseo", provider: "claude", model: "haiku" });
    expect(first.status).toMatchObject({ state: "running", conversationId: "agent-1", messageId: `devhub-${first.spec.id}` });
  });

  describe("nesting depth", () => {
    it("refuses a dispatch from inside an agent run, as before", async () => {
      await expect(dispatchAgentRun({ ...input(), depth: 1 })).rejects.toMatchObject({ status: 409 });
      expect(paseo.startPaseoAgent).not.toHaveBeenCalled();
    });

    it("lets an implement run start its assigned reviewer, one level down", async () => {
      const run = await dispatchAgentRun({ ...input(), requestId: "reviewer", depth: 1, reviewRun: true });
      expect(run.status.state).toBe("running");
      expect(paseo.startPaseoAgent.mock.calls[0][0].launch.env).toMatchObject({ DEVHUB_AGENT_DEPTH: "2" });
    });

    it("refuses anything started from inside the reviewer", async () => {
      await expect(dispatchAgentRun({ ...input(), depth: 2, reviewRun: true })).rejects.toMatchObject({ status: 409 });
      await expect(dispatchAgentRun({ ...input(), depth: 2 })).rejects.toMatchObject({ status: 409 });
    });

    it("keeps the exemption to one level when the configured limit is raised", async () => {
      vi.stubEnv("DEVHUB_AGENT_MAX_DEPTH", "2");
      await expect(dispatchAgentRun({ ...input(), depth: 3, reviewRun: true })).rejects.toMatchObject({ status: 409 });
      expect((await dispatchAgentRun({ ...input(), requestId: "ok", depth: 2, reviewRun: true })).status.state).toBe("running");
    });
  });

  it.each(["review", "pr-review"])("passes only the review MCP servers for %s runs", async (action) => {
    await dispatchAgentRun({ ...input(), requestId: `review-${action}`, activity: { source: "auto-review", action } });
    const launch = paseo.startPaseoAgent.mock.calls[0][0].launch;
    expect(Object.keys(launch.config.mcpServers ?? {}).every((name) => ["devhub", "lean-ctx"].includes(name))).toBe(true);
  });

  it("persists submission intent first and never resends after a lost acknowledgement", async () => {
    paseo.startPaseoAgent.mockImplementation(async ({ onSubmission }) => {
      onSubmission();
      expect(listAgentRuns()[0].status.submissionAttemptedAt).toBeGreaterThan(0);
      throw new Error("Timeout waiting for message (60000ms)");
    });
    const run = await dispatchAgentRun(input());
    expect(run.status.state).toBe("needs-attention");
    expect((await dispatchAgentRun(input())).spec.id).toBe(run.spec.id);
    expect(paseo.startPaseoAgent).toHaveBeenCalledTimes(1);
    await expect(dispatchAgentRun({ ...input(), prompt: "Different work" })).rejects.toMatchObject({ status: 409 });
  });

  it("releases capacity when preflight fails before submitting", async () => {
    vi.stubEnv("DEVHUB_AGENT_MAX_RUNS", "1");
    paseo.startPaseoAgent.mockRejectedValueOnce(new Error("The Paseo chat is busy."));
    const failed = await dispatchAgentRun(input());
    expect(failed.status).toMatchObject({ state: "failed", finishedAt: expect.any(Number) });
    expect(failed.status.submissionAttemptedAt).toBeUndefined();
    expect((await dispatchAgentRun({ ...input(), requestId: "next-attempt" })).status.state).toBe("running");
  });

  it("sends a follow-up to the same agent and inherits its folder and baseline", async () => {
    const first = await dispatchAgentRun(input());
    updateAgentRunStatus(first, { state: "completed", finishedAt: Date.now() });
    const next = await dispatchAgentRun({ ...input(), requestId: "next-action", parentRunId: first.spec.id, resumeSessionId: "agent-1", prompt: "Continue" });
    expect(paseo.startPaseoAgent).toHaveBeenLastCalledWith(expect.objectContaining({ resumeAgentId: "agent-1", prompt: "Continue" }));
    expect(next.spec).toMatchObject({ cwd: first.spec.cwd, baseSha: "base-sha", parentRunId: first.spec.id });
    await expect(dispatchAgentRun({ ...input(), requestId: "bad-resume", parentRunId: first.spec.id, resumeSessionId: "another-agent" })).rejects.toMatchObject({ status: 400 });
  });

  it("refuses an unavailable provider before creating or claiming a run", async () => {
    providers.listPaseoProviders.mockResolvedValue([{ id: "claude", ready: false, error: "Provider failed to initialize" }]);
    await expect(dispatchAgentRun(input())).rejects.toMatchObject({ status: 400 });
    expect(listAgentRuns()).toHaveLength(0);
    expect(paseo.startPaseoAgent).not.toHaveBeenCalled();
  });

  it("refuses a second concurrent follow-up in the same chat", async () => {
    const first = await dispatchAgentRun(input());
    updateAgentRunStatus(first, { state: "completed", finishedAt: Date.now() });
    const resume = { ...input(), parentRunId: first.spec.id, resumeSessionId: "agent-1", prompt: "Continue" };
    const results = await Promise.allSettled([
      dispatchAgentRun({ ...resume, requestId: "followup-one" }),
      dispatchAgentRun({ ...resume, requestId: "followup-two" }),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { status: 409 } });
  });

  it("falls back to the Connection tab's agent when the caller names none", async () => {
    const run = await dispatchAgentRun({ ...input(), provider: "", model: undefined, requestId: "default-agent" });
    expect(run.spec.provider).toBe("claude");
  });
});
