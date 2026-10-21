import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Context } from "../context.ts";
import { DashboardClient, DashboardHttpError, type DashboardToolResult } from "../dashboard-client.ts";
import { TOOL_ANNOTATIONS } from "../annotations.ts";
import { registerIntegrationTools } from "./integrations.ts";
import { registerEditorTools } from "./editor.ts";
import { registerPluginActionTools } from "./plugin-actions.ts";
import { registerWorkflowTools } from "./workflows.ts";

const requestId = "11111111-1111-4111-8111-111111111111";
const selection = { workspaceId: "payments-api", relativePath: "src/index.ts", revision: "diff-sha", ranges: "1-4", selectedText: "const amount = 10;", dirty: true, source: "editor", documentVersion: 7 };
const issue = { action: "issue.create", provider: "jira", account: "default", projectKey: "APP", title: "Fix checkout", body: "Check retry handling." };
const action = { action: "validate", workspace: "sample-project", args: ["--limit", "5"] };

function setup() {
  const tools = new Map<string, (input?: unknown) => Promise<DashboardToolResult>>();
  const dashboard = new DashboardClient("http://localhost:1350");
  const get = vi.spyOn(dashboard, "get").mockResolvedValue({ items: [] });
  const post = vi.spyOn(dashboard, "post").mockResolvedValue({ result: { ok: true } });
  const server = {
    registerTool(name: string, config: { inputSchema?: z.ZodRawShape }, handler: (input: unknown) => Promise<DashboardToolResult>) {
      const schema = z.object(config.inputSchema ?? {}).strict();
      tools.set(name, async (input = {}) => handler(schema.parse(input)));
    },
  };
  const context = { dashboard } as Context;
  for (const register of [registerIntegrationTools, registerEditorTools, registerPluginActionTools, registerWorkflowTools]) register(server as unknown as McpServer, context);
  const call = (name: string, input?: unknown) => {
    const handler = tools.get(name);
    if (!handler) throw new Error("Tool not registered: " + name);
    return handler(input);
  };
  return { tools, call, get, post };
}

describe("reviewed integration tools", () => {
  it("adds read-only Slack status without changing existing integration tools", async () => {
    const { call, get, post } = setup();
    await call("integrations_slack_status");
    expect(get).toHaveBeenCalledExactlyOnceWith("/api/integrations/slack/status");
    expect(post).not.toHaveBeenCalled();
    expect(TOOL_ANNOTATIONS.integrations_slack_status).toMatchObject({ readOnlyHint: true, openWorldHint: false });
  });
  it("adds read-only Slack usage that takes no input", async () => {
    const { call, get, post } = setup();
    await call("integrations_slack_usage");
    expect(get).toHaveBeenCalledExactlyOnceWith("/api/integrations/slack/usage");
    expect(post).not.toHaveBeenCalled();
    expect(TOOL_ANNOTATIONS.integrations_slack_usage).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    await expect(call("integrations_slack_usage", { date: "today" })).rejects.toThrow();
  });
  it("sends one revision-bound Slack test, with idempotence and write annotations", async () => {
    const { call, post } = setup();
    const input = { revision: "a".repeat(64), requestId };
    await call("integrations_slack_test", input);
    expect(post).toHaveBeenCalledExactlyOnceWith("/api/integrations/slack/test", input, 30_000);
    expect(TOOL_ANNOTATIONS.integrations_slack_test).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true });
    for (const invalid of [{ ...input, revision: "bad" }, { revision: input.revision }, { ...input, channel: "COTHER" }, { ...input, text: "hello" }]) await expect(call("integrations_slack_test", invalid)).rejects.toThrow();
  });
  it("preserves Slack dashboard errors without replaying the test", async () => {
    const { call, post } = setup();
    post.mockRejectedValue(new DashboardHttpError(409, { error: "Settings changed." }, "Settings changed."));
    expect(await call("integrations_slack_test", { revision: "a".repeat(64), requestId })).toMatchObject({ isError: true });
    expect(post).toHaveBeenCalledTimes(1);
  });
  it("keeps removed Telegram and approval tools callable without touching the dashboard", async () => {
    const { call, get, post } = setup();
    for (const [name, input] of [
      ["integrations_alert_destinations", {}],
      ["integrations_alert_test", { id: requestId, revision: 1, requestId }],
      ["integrations_chat_status", {}],
      ["integrations_proposals", {}],
      ["integrations_review", { id: requestId }],
      ["integrations_confirm", { id: requestId, digest: "a".repeat(64), approvedBy: "go ahead" }],
    ] as const) {
      const result = await call(name, input);
      expect(result.isError).not.toBe(true);
      expect(result.content[0]).toMatchObject({ text: expect.stringContaining("removed") });
    }
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
  it("lists provider capabilities without writing", async () => {
    const { call, get, post } = setup();
    await call("integrations_list", { taskId: requestId });
    expect(get).toHaveBeenCalledExactlyOnceWith("/api/integrations", { taskId: requestId });
    expect(post).not.toHaveBeenCalled();
  });
  it.each([
    issue,
    { ...issue, parentKey: "APP-1", taskId: requestId },
    { action: "issue.transition", provider: "jira", account: "default", ref: { provider: "jira", account: "default", kind: "issue", id: "APP-12" }, transitionId: "31" },
    { action: "pr.create", provider: "github", account: "default", repo: "acme/payments", head: "fix/retries", base: "main", title: "Fix retries", body: "Checked locally.", draft: true },
    { action: "pr.update", provider: "github", account: "default", ref: { provider: "github", account: "default", kind: "pr", id: "acme/payments/12" }, title: "Fix retries", body: "Checked locally." },
    { action: "pr.publish", provider: "github", account: "default", ref: { provider: "github", account: "default", kind: "pr", id: "acme/payments/12" } },
  ])("immediately applies %j", async (input) => {
    const { call, post } = setup();
    await call("integrations_propose", { input });
    expect(post).toHaveBeenCalledExactlyOnceWith("/api/integrations/actions", input, 60_000);
  });
  it.each([
    { ...issue, title: " " }, { ...issue, action: "confirm" }, { ...issue, confirmed: true },
    { action: "pr.create", provider: "github", account: "default", repo: "../payments", head: "fix", base: "main", title: "Fix", body: "" },
    { action: "pr.publish", provider: "github", account: "default", ref: { provider: "github", account: "other", kind: "pr", id: "acme/payments/12" } },
    { action: "issue.transition", provider: "jira", account: "default", ref: { provider: "jira", account: "default", kind: "issue", id: "invalid" }, transitionId: "31" },
  ])("rejects invalid or approval-shaped input before calling the dashboard: %j", async (input) => {
    const { call, post } = setup();
    await expect(call("integrations_propose", { input })).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });
  it("surfaces stale/profile conflicts without retry", async () => {
    const { call, post } = setup();
    post.mockRejectedValueOnce(new DashboardHttpError(409, {}, "Preview changed"));
    expect(await call("integrations_propose", { input: issue })).toMatchObject({ isError: true });
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe("editor selection and discussion tools", () => {
  it.each([
    [{ kind: "selection", id: requestId }, { id: requestId }],
    [{ kind: "workspace", workspace: "payments-api" }, { workspace: "payments-api" }],
  ])("reads selections without pairing or dispatch authority", async (target, query) => {
    const { call, get, post } = setup();
    await call("editor_selection", { target });
    expect(get).toHaveBeenCalledExactlyOnceWith("/api/editor/incoming", query);
    expect(post).not.toHaveBeenCalled();
  });
  it("previews same-checkout discussion choices without send", async () => {
    const { call, post } = setup();
    await call("editor_discussions", { selection });
    expect(post).toHaveBeenCalledExactlyOnceWith("/api/editor/selection", { selection }, 60_000);
  });
  it.each([undefined, false])("does not dispatch without human confirmation: %s", async (confirm) => {
    const { call, post } = setup();
    expect(await call("editor_discuss", { selection, requestId, question: "Explain this.", provider: "codex", confirm })).toMatchObject({ isError: true });
    expect(post).not.toHaveBeenCalled();
  });
  it("keeps exact captured text, revision and stable request id", async () => {
    const { call, post } = setup();
    const send = { requestId, question: "Explain this.", provider: "codex", runId: "existing", taskId: requestId };
    await call("editor_discuss", { selection, ...send, confirm: true });
    expect(post).toHaveBeenCalledExactlyOnceWith("/api/editor/selection", { selection, send }, 60_000);
  });
  it.each([{ selectedText: "" }, { selectedText: "x".repeat(12001) }, { documentVersion: -1 }, { source: "disk" }])("rejects invalid snapshots: %j", async (invalid) => {
    const { call, post } = setup();
    await expect(call("editor_discussions", { selection: { ...selection, ...invalid } })).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });
});

describe("plugin request-worker actions", () => {
  it.each(["actions", "runs"])("lists %s through the runtime host only", async (kind) => {
    const { call, post } = setup();
    await call("plugins_action_list", { plugin: "sample-tools", kind });
    expect(post).toHaveBeenCalledExactlyOnceWith("/api/plugins/runtime/sample-tools", { kind: "api", path: "/" + kind, method: "GET" }, 60_000);
  });
  it("reviews the exact action without executing it", async () => {
    const { call, post } = setup();
    await call("plugins_action_review", { plugin: "sample-tools", input: action });
    expect(post).toHaveBeenCalledExactlyOnceWith("/api/plugins/runtime/sample-tools", { kind: "api", path: "/actions/review", method: "POST", body: action }, 60_000);
  });
  it("rejects invalid plugin names and oversized input before dispatch", async () => {
    const { call, post } = setup();
    for (const plugin of ["../escape", "sample/tools", "", "a".repeat(64)]) {
      await expect(call("plugins_action_review", { plugin, input: action })).rejects.toThrow();
    }
    await expect(call("plugins_action_review", { plugin: "sample-tools", input: { value: "x".repeat(32_769) } })).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });
  it.each([undefined, false])("never consumes a review token without confirmation: %s", async (confirm) => {
    const { call, post } = setup();
    expect(await call("plugins_action_run", { plugin: "sample-tools", token: requestId, confirm })).toMatchObject({ isError: true });
    expect(post).not.toHaveBeenCalled();
  });
  it("returns output and the final worker receipt after exactly one reviewed execution", async () => {
    const { call, post } = setup();
    post.mockResolvedValueOnce('{"type":"output","text":"Checking demo rows"}\n{"type":"result","result":{"ok":true,"runId":"remote-run"}}\n');
    const response = await call("plugins_action_run", { plugin: "sample-tools", token: requestId, confirm: true });
    expect(post).toHaveBeenCalledExactlyOnceWith("/api/plugins/runtime/sample-tools", { kind: "api", path: "/actions/execute", method: "POST", body: { token: requestId } }, 900_000);
    expect(response.content[0]).toMatchObject({ text: expect.stringContaining("Checking demo rows") });
    expect(response.content[0]).toMatchObject({ text: expect.stringContaining("remote-run") });
    expect(response.isError).not.toBe(true);
  });
  it.each([
    '{"type":"output","text":"Started"}\n',
    '{"type":"result","result":{"ok":false,"error":"Review expired"}}\n',
    'malformed response',
    '{"type":"result"}\n',
    '{"type":"error","error":"Worker stopped"}\n',
    { type: "result", result: null },
  ])("surfaces failed/ambiguous execution and does not retry: %s", async (data) => {
    const { call, post } = setup();
    post.mockResolvedValueOnce(data);
    const response = await call("plugins_action_run", { plugin: "sample-tools", token: requestId, confirm: true });
    expect(response.isError).toBe(true);
    expect(response.content).toContainEqual({ type: "text", text: expect.stringContaining("Do not automatically retry") });
    expect(post).toHaveBeenCalledTimes(1);
  });
  it("handles a single result event already decoded by DashboardClient", async () => {
    const { call, post } = setup();
    post.mockResolvedValueOnce({ type: "result", result: { ok: true, exitCode: 0 } });
    const response = await call("plugins_action_run", { plugin: "sample-tools", token: requestId, confirm: true });
    expect(response.isError).not.toBe(true);
    expect(response.content[0]).toMatchObject({ text: JSON.stringify({ ok: true, exitCode: 0 }) });
    expect(post).toHaveBeenCalledTimes(1);
  });
  it("preserves plugin refusal and reads remote status without another run", async () => {
    const { call, post } = setup();
    post.mockRejectedValueOnce(new DashboardHttpError(403, {}, "Plugin not reviewed"));
    expect(await call("plugins_action_run", { plugin: "sample-tools", token: requestId, confirm: true })).toMatchObject({ isError: true });
    await call("plugins_action_status", { plugin: "sample-tools", runId: requestId });
    expect(post).toHaveBeenLastCalledWith("/api/plugins/runtime/sample-tools", { kind: "api", path: "/runs/status", method: "POST", body: { runId: requestId } }, 60_000);
    expect(post).toHaveBeenCalledTimes(2);
  });
});

describe("durable task reviews", () => {
  it("reads workflow evidence and the inbox without rerunning checks", async () => {
    const { call, get, post } = setup();
    await call("tasks_workflow_get", { taskId: requestId });
    await call("tasks_workflow_get");
    expect(get).toHaveBeenCalledWith("/api/tasks/workflow", { taskId: requestId }, 60_000);
    expect(get).toHaveBeenCalledWith("/api/tasks/workflow", undefined, 60_000);
    expect(post).not.toHaveBeenCalled();
  });
  it("records a review with the exact revision, but exposes no decision operation", async () => {
    const { call, post, tools } = setup();
    const input = { taskId: requestId, revision: 8, runId: "review-run", verdict: "pass", findings: "No must-fix findings." };
    await call("tasks_workflow_review", input);
    expect(post).toHaveBeenCalledExactlyOnceWith("/api/tasks/workflow", { ...input, action: "review" }, 60_000);
    await expect(call("tasks_workflow_review", { ...input, action: "decide", approve: true })).rejects.toThrow();
    expect(tools.has("tasks_workflow_decide")).toBe(false);
  });
  it("does not retry stale review evidence", async () => {
    const { call, post } = setup();
    post.mockRejectedValueOnce(new DashboardHttpError(409, {}, "Code changed"));
    expect(await call("tasks_workflow_review", { taskId: requestId, revision: 8, runId: "review-run", verdict: "pass", findings: "Reviewed." })).toMatchObject({ isError: true });
    expect(post).toHaveBeenCalledTimes(1);
  });
  it("annotates all new tools by actual side effects", () => {
    const { tools } = setup();
    for (const name of tools.keys()) expect(TOOL_ANNOTATIONS[name], name).toBeDefined();
    expect(TOOL_ANNOTATIONS.plugins_action_run).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true });
    expect(TOOL_ANNOTATIONS.editor_discussions).toMatchObject({ readOnlyHint: true });
    expect(TOOL_ANNOTATIONS.tasks_workflow_get).toMatchObject({ readOnlyHint: false, idempotentHint: true });
  });
});
