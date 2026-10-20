import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("node:os", async () => (await import("@/lib/test-home")).isolatedOs());

const paseo = vi.hoisted(() => ({
  agents: new Map<string, { status: string; pendingPermissions: unknown[] } | null>(),
  timelines: new Map<string, unknown[]>(),
  unreachable: false,
  calls: 0,
}));
vi.mock("@/lib/paseo/client", () => ({
  paseoUrl: () => "ws://127.0.0.1:6767/ws",
  withPaseo: async (fn: (session: unknown) => Promise<unknown>) => {
    paseo.calls += 1;
    if (paseo.unreachable) throw new Error("Paseo is unavailable.");
    return fn({
      api: {},
      daemon: {
        fetchAgent: async (id: string) => { const agent = paseo.agents.get(id); return agent ? { agent } : null; },
        fetchAgentTimeline: async (id: string) => ({ entries: paseo.timelines.get(id) ?? [], hasOlder: false }),
      },
    });
  },
}));
vi.mock("@/lib/tasks/task-agent-runs", () => ({ syncTaskAgentRunFromAgentState: vi.fn(async () => undefined) }));
vi.mock("@/lib/tasks/run-snapshot", () => ({ recordRunSnapshot: vi.fn(async () => false) }));
vi.mock("@/lib/workflows/store", () => ({ recordWorkflowRun: vi.fn(async () => undefined) }));
import { clearCapacityProbeCache, clearManagedRun, reconcileCapacityRuns, reconcileManagedRun } from "@/lib/paseo/lifecycle";
import type { AgentRunState, AgentRunStatus } from "./run-files";
import { countActiveAgentRuns, createAgentRun, listCapacityRuns, newAgentRunId, readAgentRun, updateAgentRunStatus } from "./store";

const DAY = 86_400_000;
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.homedir(), ".devhub-capacity-test-"));
  vi.stubEnv("DEVHUB_AGENT_RUNS_DIR", path.join(root, "runs"));
  vi.stubEnv("NOTES_DIR", path.join(root, "notes"));
  paseo.agents.clear(); paseo.timelines.clear(); paseo.unreachable = false; paseo.calls = 0;
  clearCapacityProbeCache();
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

function managed(title: string, state: AgentRunState, status: Partial<AgentRunStatus> = {}, createdAt = Date.now() - 5 * DAY, runtime: "paseo" | "aionui" = "paseo") {
  const run = createAgentRun({
    id: newAgentRunId(), schemaVersion: 2, runtime, provider: "cursor", providerLabel: "cursor", bin: runtime,
    args: [], format: "text", cwd: root, title, prompt: "prompt", depth: 0, createdAt,
  });
  return updateAgentRunStatus(run, { state, connectionId: "ws://127.0.0.1:6767/ws", ...status });
}
const sent = (messageId: string) => ({ item: { type: "user_message", text: "go", clientMessageId: messageId } });
const said = (text: string) => ({ item: { type: "assistant_message", text, messageId: "a1" } });
const agent = (id: string, status: string, timeline: unknown[]) => { paseo.agents.set(id, { status, pendingPermissions: [] }); paseo.timelines.set(id, timeline); };
const countedTitles = () => listCapacityRuns().map((run) => run.spec.title).sort();

describe("agent capacity matches reality", () => {
  it("stops counting runs whose Paseo session is gone, and keeps the ones really running", async () => {
    // A start that never got an agent, and three sessions that ended without DevHub hearing about it.
    managed("never acknowledged", "needs-attention", { submissionAttemptedAt: Date.now() - 5 * DAY, messageId: "m-a", error: "Startup was interrupted" });
    const idleLost = managed("idle, message not in timeline", "needs-attention", { conversationId: "c-b", messageId: "m-b" });
    const missing = managed("agent deleted", "needs-attention", { conversationId: "c-c", messageId: "m-c" });
    const closed = managed("agent closed", "needs-attention", { conversationId: "c-d", messageId: "m-d" });
    agent("c-b", "idle", []);
    paseo.agents.set("c-c", null);
    agent("c-d", "closed", [sent("m-d")]);
    // Two that are genuinely working.
    managed("plan one", "running", { conversationId: "c-e", messageId: "m-e" }, Date.now() - 60_000);
    managed("plan two", "running", { conversationId: "c-f", messageId: "m-f" }, Date.now() - 60_000);
    agent("c-e", "running", [sent("m-e")]);
    agent("c-f", "running", [sent("m-f")]);

    // Reading already drops the start that was never acknowledged; the rest need Paseo.
    expect(countActiveAgentRuns()).toBe(5);
    await reconcileCapacityRuns();

    expect(countedTitles()).toEqual(["plan one", "plan two"]);
    expect(countActiveAgentRuns()).toBe(2);
    for (const stale of [idleLost, missing, closed]) {
      expect(readAgentRun(stale.spec.id)?.status).toMatchObject({ state: "failed", finishedAt: expect.any(Number), error: expect.any(String) });
    }
  });

  it("finishes an unacknowledged start on read, but not one that is still launching", () => {
    const old = managed("old start", "starting", { submissionAttemptedAt: Date.now() - 2 * DAY });
    const neverSent = managed("never sent", "starting", {});
    const launching = managed("launching", "starting", {}, Date.now() - 60_000);
    expect(readAgentRun(old.spec.id)?.status).toMatchObject({ state: "failed", error: expect.stringContaining("never acknowledged") });
    expect(readAgentRun(neverSent.spec.id)?.status).toMatchObject({ state: "failed", error: "This run never reached Paseo." });
    expect(readAgentRun(launching.spec.id)?.status.state).toBe("starting");
    expect(countedTitles()).toEqual(["launching"]);
  });

  it("keeps a result the agent produced before it was closed", async () => {
    const run = managed("closed after finishing", "needs-attention", { conversationId: "c-1", messageId: "m-1" });
    agent("c-1", "closed", [sent("m-1"), said("shipped it")]);
    expect((await reconcileManagedRun(run)).status).toMatchObject({ state: "completed", resultText: "shipped it" });
  });

  it("does not probe a run again when it was just checked", async () => {
    managed("live", "running", { conversationId: "c-1", messageId: "m-1" }, Date.now() - 60_000);
    agent("c-1", "running", [sent("m-1")]);
    await reconcileCapacityRuns();
    const probed = paseo.calls;
    expect(probed).toBeGreaterThan(0);
    await reconcileCapacityRuns();
    expect(paseo.calls).toBe(probed);
  });

  it("does not drop a run just because Paseo can't be reached", async () => {
    const run = managed("reachable later", "running", { conversationId: "c-1", messageId: "m-1" });
    paseo.unreachable = true;
    await reconcileCapacityRuns();
    expect(readAgentRun(run.spec.id)?.status).toMatchObject({ state: "running", connectivity: "reconnecting" });
    expect(countActiveAgentRuns()).toBe(1);
  });

  it("finishes historical AionUi runs instead of re-flagging them forever", async () => {
    const run = managed("old aionui", "needs-attention", { conversationId: "abc" }, Date.now() - 20 * DAY, "aionui");
    expect((await reconcileManagedRun(run)).status).toMatchObject({ state: "failed", finishedAt: expect.any(Number) });
    expect((await reconcileManagedRun(readAgentRun(run.spec.id)!)).status.state).toBe("failed");
  });
});

describe("clearing a run", () => {
  it("clears a run DevHub can no longer follow, without touching Paseo", async () => {
    const run = managed("stuck", "needs-attention", { conversationId: "c-1", messageId: "m-1" }, Date.now() - 60_000);
    paseo.agents.set("c-1", { status: "running", pendingPermissions: [{ id: "p" }] });
    paseo.timelines.set("c-1", [sent("m-1")]);
    const { outcome, run: cleared } = await clearManagedRun(run);
    expect(outcome).toBe("cleared");
    expect(cleared.status).toMatchObject({ state: "cancelled", finishedAt: expect.any(Number), error: expect.stringContaining("not stopped") });
    expect(countActiveAgentRuns()).toBe(0);
  });

  it("refuses to clear a run that is really working", async () => {
    const run = managed("working", "running", { conversationId: "c-1", messageId: "m-1" }, Date.now() - 60_000);
    agent("c-1", "running", [sent("m-1")]);
    expect((await clearManagedRun(run)).outcome).toBe("still-running");
    expect(readAgentRun(run.spec.id)?.status.state).toBe("running");
  });

  it("clears a run stuck unreachable", async () => {
    const run = managed("unreachable", "running", { conversationId: "c-1", messageId: "m-1", connectivity: "reconnecting" });
    paseo.unreachable = true;
    expect((await clearManagedRun(run)).outcome).toBe("cleared");
  });

  it("reports an already-finished run as such", async () => {
    const run = managed("done", "completed", { finishedAt: Date.now() });
    expect((await clearManagedRun(run)).outcome).toBe("already-finished");
  });
});
