import os from "node:os";
import { beforeEach, expect, it, vi } from "vitest";
import type { AgentRun } from "./store";
import { dispatchAgentRun } from "./dispatch";
import { startBackgroundAgent } from "./background";
import { autoDeps } from "../storyboard/orchestrator";
import { withOrchestrationAuthorisation } from "../storyboard/orchestration-store";

const fixture = vi.hoisted(() => ({
  run: undefined as AgentRun | undefined,
  beforeProviders: async () => {},
  beforeSubmission: async () => {},
  beforeClaimReturns: async () => {},
  claims: new Map<string, string>(),
  created: vi.fn(),
  submitted: vi.fn(),
}));

vi.mock("../../domains/tasks/storage", async (original) => ({
  ...await original<typeof import("../../domains/tasks/storage")>(), ensureTasksMigrated: async () => {},
}));
vi.mock("./store", async (original) => ({
  ...await original<typeof import("./store")>(),
  newAgentRunId: () => "run-abcdef-00000000", agentRunDir: () => "/fixture/run",
  listCapacityRuns: () => [], listAgentRuns: () => [], readAgentRun: () => fixture.run,
  createAgentRun: (spec: AgentRun["spec"]) => {
    fixture.created();
    fixture.run = { spec, status: { state: "queued", updatedAt: Date.now(), eventCount: 0 }, dir: "/fixture/run" };
    return fixture.run;
  },
  updateAgentRunStatus: (run: AgentRun, patch: Partial<AgentRun["status"]>) => {
    fixture.run = { ...run, status: { ...run.status, ...patch } };
    return fixture.run;
  },
}));
vi.mock("./run-files", async (original) => ({
  ...await original<typeof import("./run-files")>(), writeRunSpec: () => {},
}));
vi.mock("./claims", () => ({
  readAgentRequest: (request: string) => fixture.claims.get(request) ?? null,
  claimAgentRequest: async (request: string, id: string) => {
    const winner = fixture.claims.get(request) ?? id;
    fixture.claims.set(request, winner);
    await fixture.beforeClaimReturns();
    return winner;
  },
  releaseAgentRequest: async (request: string, id: string) => {
    if (fixture.claims.get(request) === id) fixture.claims.delete(request);
  },
  withAgentAdmission: <T,>(action: () => T) => action(),
}));
vi.mock("./git", async (original) => ({
  ...await original<typeof import("./git")>(), gitHead: async () => "fixture-head",
}));
vi.mock("../paseo/client", async (original) => ({
  ...await original<typeof import("../paseo/client")>(),
  paseoUrl: () => "http://fixture.invalid", openPaseoSession: async () => ({ close: () => {} }),
}));
vi.mock("../paseo/providers", async (original) => ({
  ...await original<typeof import("../paseo/providers")>(),
  listPaseoProviders: async () => { await fixture.beforeProviders(); return [{ id: "codex", ready: true, models: [] }]; },
}));
vi.mock("../paseo/launch", async (original) => ({
  ...await original<typeof import("../paseo/launch")>(),
  resolvePaseoLaunch: () => ({ provider: "codex", config: { provider: "codex/default" }, env: {} }),
}));
vi.mock("../paseo/dispatch", () => ({
  startPaseoAgent: async ({ onSubmission }: { onSubmission: (messageId: string) => void }) => {
    await fixture.beforeSubmission();
    onSubmission("fixture-message");
    fixture.submitted();
    return { agentId: "fixture-agent", messageId: "fixture-message" };
  },
}));

beforeEach(() => {
  fixture.run = undefined;
  fixture.beforeProviders = async () => {};
  fixture.beforeSubmission = async () => {};
  fixture.beforeClaimReturns = async () => {};
  fixture.claims.clear();
  fixture.created.mockClear();
  fixture.submitted.mockClear();
});

const input = { provider: "codex", prompt: "Fixture investigation", cwd: os.homedir(), title: "Fixture", depth: 0, worktree: false };

it("refuses a changed review before creating the durable run", async () => {
  let current = true;
  fixture.beforeProviders = async () => { current = false; };
  await expect(dispatchAgentRun(input, { canStart: () => current })).rejects.toThrow("cancelled or changed");
  expect(fixture.created).not.toHaveBeenCalled();
  expect(fixture.submitted).not.toHaveBeenCalled();
});

it("refuses a changed review after preflight and before Paseo submission", async () => {
  let entered: () => void = () => {};
  let release: () => void = () => {};
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { entered = resolve; });
  fixture.beforeSubmission = async () => { entered(); await waiting; };
  let current = true;
  const pending = dispatchAgentRun(input, { canStart: () => current });
  await ready;
  current = false;
  release();
  const run = await pending;
  expect(run.status.state).toBe("failed");
  expect(run.status.submissionAttemptedAt).toBeUndefined();
  expect(fixture.submitted).not.toHaveBeenCalled();
});

it("starts normally while the reviewed request stays current", async () => {
  const result = await startBackgroundAgent({ ...input, requestId: "fixture", canStart: () => true });
  expect(result).toMatchObject({ channel: "run", conversationId: "fixture-agent" });
  expect(fixture.submitted).toHaveBeenCalledOnce();
});

const auto = autoDeps({ dispatch: dispatchAgentRun, resolveRepos: async () => [], findTask: async () => null }, "/fixture/notes");

it("releases a persisted claim when service authority is revoked so the request can retry", async () => {
  let current = true;
  const request = { ...input, requestId: "revoked-during-claim" };
  fixture.beforeClaimReturns = async () => { current = false; };
  await expect(withOrchestrationAuthorisation(() => current, () => auto.dispatch(request))).rejects.toThrow("cancelled or changed");
  expect(fixture.created).not.toHaveBeenCalled();
  expect(fixture.submitted).not.toHaveBeenCalled();
  expect(fixture.claims.has(request.requestId)).toBe(false);

  fixture.beforeClaimReturns = async () => {};
  current = true;
  const run = await withOrchestrationAuthorisation(() => current, () => auto.dispatch(request));
  expect(run.status.state).toBe("running");
  expect(fixture.claims.get(request.requestId)).toBe(run.spec.id);
  expect(fixture.submitted).toHaveBeenCalledOnce();
});

it("refuses service dispatch when authorisation changes during provider setup", async () => {
  let current = true;
  fixture.beforeProviders = async () => { current = false; };
  await expect(withOrchestrationAuthorisation(() => current, () => auto.dispatch(input, { defer: true }))).rejects.toThrow("cancelled or changed");
  expect(fixture.created).not.toHaveBeenCalled();
  expect(fixture.submitted).not.toHaveBeenCalled();
});

it("releases a claim if creating its run fails before submission", async () => {
  fixture.created.mockImplementationOnce(() => { throw new Error("Run storage unavailable"); });
  const request = { ...input, requestId: "run-storage-failure" };
  await expect(dispatchAgentRun(request)).rejects.toThrow("Run storage unavailable");
  expect(fixture.claims.has(request.requestId)).toBe(false);
  expect(fixture.submitted).not.toHaveBeenCalled();
  expect((await dispatchAgentRun(request)).status.state).toBe("running");
  expect(fixture.submitted).toHaveBeenCalledOnce();
});

it("refuses service dispatch when authorisation changes before submission", async () => {
  let current = true;
  fixture.beforeSubmission = async () => { current = false; };
  const run = await withOrchestrationAuthorisation(() => current, () => auto.dispatch(input, { defer: true }));
  expect(run.status.state).toBe("failed");
  expect(run.status.submissionAttemptedAt).toBeUndefined();
  expect(fixture.submitted).not.toHaveBeenCalled();
});

it("finishes an authorised service submission before returning its response", async () => {
  const run = await withOrchestrationAuthorisation(() => true, () => auto.dispatch(input, { defer: true }));
  expect(run.status.state).toBe("running");
  expect(fixture.submitted).toHaveBeenCalledOnce();
});
