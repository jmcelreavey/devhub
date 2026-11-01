import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import { agentBackground, agentBootstrap, agentCapacity, agentCatalogCreate, agentCatalogDelete, agentCatalogRename, agentCatalogSave, agentClear, agentConnection, agentDispatch, agentDispatchBodyInput, agentFollowupBodyInput, agentInteractive, agentInteractiveFinishInput, agentInteractiveNoteInput, agentRace, agentRuns, agentsCatalogList } from "../../../../packages/shared/actions/agents.ts";
import { paseoCliPreferences, paseoCliUpdates, paseoManagedActions, paseoManagedInput, paseoManagedStatus, paseoOpen, paseoTaskContext, paseoUpdate } from "../../../../packages/shared/actions/paseo.ts";
import type { Context } from "../context.ts";
import { DashboardClient } from "../dashboard-client.ts";
import { callerDepth, registerAgentTools } from "./agents.ts";
import { registerWorkspaceTools } from "./workspace.ts";

it("keeps local Paseo settings and context validation off the MCP surface", () => {
  expect(paseoCliPreferences.input.safeParse({ agent: "Codex", pinned: true }).success).toBe(true);
  expect(paseoCliPreferences.input.safeParse({ agent: "unknown", pinned: true }).success).toBe(false);
  expect(paseoCliPreferences.input.safeParse({ agent: "Codex" }).success).toBe(false);
  expect(paseoCliPreferences.input.safeParse({ enabled: true, extra: true }).success).toBe(false);
  expect(paseoTaskContext.input.safeParse({ query: "x".repeat(301) }).success).toBe(false);
  expect(paseoManagedInput.safeParse({ action: "default-provider", provider: "bad/provider" }).success).toBe(false);
  expect(paseoManagedInput.safeParse({ action: "pair" }).success).toBe(true);
  expect(paseoManagedInput.safeParse({ action: "update", version: "1.2.3" }).success).toBe(true);
  expect(paseoManagedInput.safeParse({ action: "update" }).success).toBe(false);
  expect(paseoManagedInput.safeParse({ action: "update", version: "latest" }).success).toBe(false);
  for (const action of [paseoCliPreferences, paseoCliUpdates, paseoManagedStatus, paseoOpen, paseoTaskContext, paseoUpdate, ...Object.values(paseoManagedActions)]) {
    expect(action.mcp).toHaveProperty("reason");
  }
});

it("keeps local agent launch and bootstrap actions off MCP", () => {
  expect(agentBackground.input.safeParse({ prompt: " " }).success).toBe(false);
  expect(agentInteractive.input.safeParse({ provider: "fixture", prompt: "test", cwd: " " }).success).toBe(false);
  for (const action of [agentBackground, agentBootstrap, agentCapacity, agentClear, agentConnection, agentInteractive]) expect(action.mcp).toHaveProperty("reason");
});

it("keeps agent catalog validation and destructive methods on the dashboard", () => {
  expect(agentCatalogCreate.input.safeParse({ name: "../escape", description: "fixture" }).success).toBe(false);
  expect(agentCatalogSave.input.safeParse({ name: "fixture", content: " " }).success).toBe(false);
  expect(agentCatalogRename.input.safeParse({ name: "fixture", newName: "../escape" }).success).toBe(false);
  expect(agentCatalogSave.http).toMatchObject({ method: "PUT" });
  expect(agentCatalogRename.http).toMatchObject({ method: "PATCH" });
  expect(agentCatalogDelete.http).toMatchObject({ method: "DELETE" });
  for (const action of [agentCatalogCreate, agentCatalogSave, agentCatalogRename, agentCatalogDelete]) expect(action.mcp).toHaveProperty("reason");
});

it("keeps agents_list on the existing MCP and dashboard surfaces", async () => {
  const dashboard = new DashboardClient("http://localhost:1447");
  const get = vi.spyOn(dashboard, "get").mockResolvedValue([{ name: "fixture", description: "Fixture agent" }]);
  const handlers = new Map<string, (input: object) => Promise<{ content: Array<{ text?: string }> }>>();
  const server = { registerTool: (name: string, _config: object, handler: typeof handlers extends Map<string, infer Handler> ? Handler : never) => handlers.set(name, handler) };
  registerWorkspaceTools(server as unknown as McpServer, { dashboard } as Context);
  expect(agentsCatalogList.http).toMatchObject({ method: "GET", path: "/api/agents" });
  expect((await handlers.get("agents_list")!({})).content[0].text).toContain("**fixture** — Fixture agent");
  expect(get).toHaveBeenCalledWith("/api/agents");
});

describe("callerDepth", () => {
  it("reads DEVHUB_AGENT_DEPTH and treats junk as a top-level caller", () => {
    expect(callerDepth({ DEVHUB_AGENT_DEPTH: "2" })).toBe(2);
    expect(callerDepth({ DEVHUB_AGENT_DEPTH: "nope" })).toBe(0);
    expect(callerDepth({})).toBe(0);
  });
});

it("keeps the dispatch request id unchanged across retries", async () => {
  const dashboard = new DashboardClient("http://localhost:1447");
  const run = {
    id: "run-fixture-00000001", providerLabel: "Fixture", model: null, state: "queued", title: "Fixture",
    cwd: "/fixture", worktree: null, parentRunId: null, terminalSessionId: null, conversationId: null,
    turns: null, costUsd: null, exitCode: null, resultText: null, error: null,
  };
  const post = vi.spyOn(dashboard, "post").mockResolvedValue({ run });
  const handlers = new Map<string, (input: object) => Promise<{ content: Array<{ text?: string }> }>>();
  const server = {
    registerTool(name: string, config: { inputSchema?: unknown }, handler: (input: object) => Promise<{ content: Array<{ text?: string }> }>) {
      if (name === "agent_dispatch") expect(config.inputSchema).toBe(agentDispatch.input);
      handlers.set(name, handler);
    },
  };
  registerAgentTools(server as unknown as McpServer, { dashboard } as Context);
  const input = { requestId: "fixture-request", provider: "fixture", prompt: "test", cwd: "/fixture" };
  const dispatch = handlers.get("agent_dispatch")!;
  expect((await dispatch(input)).content[0].text).toContain(run.id);
  expect((await dispatch(input)).content[0].text).toContain(run.id);
  expect(post).toHaveBeenCalledTimes(2);
  expect(post).toHaveBeenNthCalledWith(1, "/api/agent/runs", expect.objectContaining({ requestId: input.requestId }));
  expect(post).toHaveBeenNthCalledWith(2, "/api/agent/runs", expect.objectContaining({ requestId: input.requestId }));
});

it("keeps dashboard-only dispatch options and validation", () => {
  const parsed = agentDispatchBodyInput.parse({
    requestId: "fixture-request", provider: " fixture ", prompt: " task ", cwd: " /fixture ",
    taskId: "task-1", taskDate: "2026-10-29", tier: "mid", depth: 2, defer: true,
  });
  expect(parsed).toMatchObject({
    requestId: "fixture-request", provider: "fixture", prompt: "task", cwd: "/fixture",
    taskId: "task-1", taskDate: "2026-10-29", tier: "mid", depth: 2, defer: true,
  });
  expect(agentFollowupBodyInput.parse({ prompt: " retry ", requestId: "same-request", depth: 2 })).toMatchObject({ prompt: "retry", requestId: "same-request", depth: 2 });
  expect(agentInteractiveNoteInput.safeParse({ runId: "run-fixture-00000001", text: " " }).success).toBe(false);
  expect(agentInteractiveFinishInput.parse({ runId: "run-fixture-00000001", ok: false, error: " failed " }).error).toBe("failed");
});

it("keeps the agent run list limit and delegates it unchanged", async () => {
  const read = vi.fn().mockResolvedValue({ runs: [] });
  expect(await agentRuns.handler({ limit: 3 }, { read })).toEqual({ runs: [] });
  expect(read).toHaveBeenCalledWith(3);
  expect(agentRuns.input.safeParse({ limit: 101 }).success).toBe(false);
});

it("does not dispatch a race without distinct providers and reports partial failures", async () => {
  const dispatch = vi.fn()
    .mockResolvedValueOnce({ id: "run-fixture-00000001", cwd: "/fixture", worktree: { branch: "fixture" } })
    .mockRejectedValueOnce(new Error("unavailable"));
  const input = { providers: ["one", "one"], prompt: "test", cwd: "/fixture" };
  expect(await agentRace.handler(input, { dispatch })).toMatchObject({ isError: true });
  expect(dispatch).not.toHaveBeenCalled();
  const result = await agentRace.handler({ ...input, providers: ["one", "two"] }, { dispatch });
  expect(result.text).toContain("one: run-fixture-00000001 → fixture");
  expect(result.text).toContain("two: FAILED — unavailable");
});

it("keeps the requested output cursor when a run has no new events", async () => {
  const dashboard = new DashboardClient("http://localhost:1447");
  const run = {
    id: "run-fixture-00000001", providerLabel: "Fixture", model: null, state: "completed", title: "Fixture",
    cwd: "/fixture", worktree: null, parentRunId: null, terminalSessionId: null, conversationId: null,
    turns: null, costUsd: null, exitCode: null, resultText: null, error: null,
  };
  const get = vi.spyOn(dashboard, "get").mockResolvedValue({ run, events: [], next: 12, total: 12 });
  const handlers = new Map<string, (input: object) => Promise<{ content: Array<{ text?: string }> }>>();
  const server = { registerTool: (name: string, _config: object, handler: typeof handlers extends Map<string, infer Handler> ? Handler : never) => handlers.set(name, handler) };
  registerAgentTools(server as unknown as McpServer, { dashboard } as Context);
  const result = await handlers.get("agent_output")!({ runId: run.id, since: 8 });
  expect(get).toHaveBeenCalledWith(`/api/agent/runs/${run.id}`, { since: 8, limit: 200 });
  expect(result.content[0].text).toContain("No new events since 8. Next cursor: since=12");
});

it("preserves cancellation and progress for agent waits", async () => {
  const dashboard = new DashboardClient("http://localhost:1447");
  const run = {
    id: "run-fixture-00000001", providerLabel: "Fixture", model: null, state: "running", title: "Fixture",
    cwd: "/fixture", worktree: null, parentRunId: null, terminalSessionId: null, conversationId: null,
    turns: null, costUsd: null, exitCode: null, resultText: null, error: null,
  };
  const get = vi.spyOn(dashboard, "get").mockResolvedValue({ run, events: [], next: 0, total: 0 });
  const handlers = new Map<string, (input: object, extra: {
    signal: AbortSignal;
    _meta?: { progressToken: string };
    sendNotification: (value: object) => Promise<void>;
  }) => Promise<{ content: Array<{ text?: string }> }>>();
  const server = { registerTool: (name: string, _config: object, handler: typeof handlers extends Map<string, infer Handler> ? Handler : never) => handlers.set(name, handler) };
  registerAgentTools(server as unknown as McpServer, { dashboard } as Context);
  const controller = new AbortController();
  controller.abort();
  const sendNotification = vi.fn().mockResolvedValue(undefined);
  const wait = handlers.get("agent_wait")!;
  const result = await wait({ runId: run.id }, { signal: controller.signal, sendNotification });
  expect(result.content[0].text).toContain("Still running");
  expect(get).toHaveBeenCalledTimes(1);

  get.mockResolvedValueOnce({
    run: { ...run, state: "cancelled" },
    events: [{ seq: 0, ts: 0, type: "text", text: "stopped" }],
    next: 1,
    total: 1,
  });
  const finished = await wait({ runId: run.id }, { signal: new AbortController().signal, _meta: { progressToken: "fixture" }, sendNotification });
  expect(finished.content[0].text).toContain("Run cancelled.");
  expect(sendNotification).toHaveBeenCalledWith({
    method: "notifications/progress",
    params: { progressToken: "fixture", progress: 1, message: "[0] stopped" },
  });
});
