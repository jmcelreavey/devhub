import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AionRequestError } from "@/lib/aionui/client";

const native = vi.hoisted(() => ({ createConversation: vi.fn(), sendMessage: vi.fn(), getConversation: vi.fn(), listEnabledMcpIds: vi.fn(), listManagedEnabledMcpIds: vi.fn() }));
vi.mock("@/lib/aionui/catalog", () => ({
  aionCatalog: async () => ({ session: { origin: "http://127.0.0.1:25818", userId: "user", anchorConversationId: "anchor", defaultAssistantId: "claude" }, client: native, assistants: [{ id: "claude", name: "Claude", enabled: true, agent_status: "online", models: [] }] }),
  assistantForProvider: (assistants: { id: string }[], provider: string) => assistants.find(a => a.id === provider),
}));
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
  native.createConversation.mockResolvedValue({ id: "chat" });
  native.getConversation.mockResolvedValue({ id: "chat" });
  native.sendMessage.mockResolvedValue({ msg_id: "message", turn_id: "turn", delivered_midturn: false });
  native.listEnabledMcpIds.mockResolvedValue(["mcp_devhub", "mcp_lean-ctx"]);
  native.listManagedEnabledMcpIds.mockResolvedValue(["mcp_devhub"]);
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
const input = () => ({ provider: "claude", prompt: "Synthetic test", cwd: root, depth: 0, worktree: false, requestId: "one-action" });

describe("durable managed dispatch", () => {
  it("claims concurrent retries once and returns the saved run after capacity fills", async () => {
    vi.stubEnv("DEVHUB_AGENT_MAX_RUNS", "1");
    const [first, retry] = await Promise.all([dispatchAgentRun(input()), dispatchAgentRun(input())]);
    expect(first.spec.id).toBe(retry.spec.id);
    expect(native.createConversation).toHaveBeenCalledTimes(1);
    expect(native.createConversation.mock.calls[0][0]).toMatchObject({
      mcpIds: ["mcp_devhub", "mcp_lean-ctx"],
    });
    expect(native.sendMessage).toHaveBeenCalledTimes(1);
    expect(listAgentRuns()).toHaveLength(1);
    expect((await dispatchAgentRun(input())).spec.id).toBe(first.spec.id);
    expect(first.status.terminalSessionId).toBeUndefined();
  });
  it("persists submission intent before sending and never retries a lost acknowledgement", async () => {
    native.sendMessage.mockImplementation(async () => {
      expect(listAgentRuns()[0].status.submissionAttemptedAt).toBeGreaterThan(0);
      throw new AionRequestError("Acknowledgement lost", undefined, true);
    });
    const run = await dispatchAgentRun(input());
    expect(run.status.state).toBe("needs-attention");
    expect((await dispatchAgentRun(input())).spec.id).toBe(run.spec.id);
    expect(native.sendMessage).toHaveBeenCalledTimes(1);
    await expect(dispatchAgentRun({ ...input(), prompt: "Different work" })).rejects.toMatchObject({ status: 409 });
  });
  it("resumes the same managed conversation and inherits its folder and baseline", async () => {
    const first = await dispatchAgentRun(input());
    updateAgentRunStatus(first, { state: "completed", finishedAt: Date.now() });
    const next = await dispatchAgentRun({ ...input(), requestId: "next-action", parentRunId: first.spec.id, resumeSessionId: "chat", prompt: "Continue" });
    expect(native.createConversation).toHaveBeenCalledTimes(1);
    expect(native.sendMessage).toHaveBeenLastCalledWith("chat", "Continue");
    expect(next.spec).toMatchObject({ cwd: first.spec.cwd, baseSha: "base-sha", parentRunId: first.spec.id });
    await expect(dispatchAgentRun({ ...input(), requestId: "bad-resume", parentRunId: first.spec.id, resumeSessionId: "another-chat" })).rejects.toMatchObject({ status: 400 });
  });
});
