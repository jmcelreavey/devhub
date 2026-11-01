import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import { terminalPasteImage, terminalProposalStream, terminalSearch, terminalTranscript } from "../../../../packages/shared/actions/terminal.ts";
import type { Context } from "../context.ts";
import { DashboardClient } from "../dashboard-client.ts";
import { registerTerminalTools } from "./terminal.ts";

interface RunInput {
  command: string;
  cwd?: string;
  kind?: "upstart";
  label?: string;
}

it("keeps binary uploads and transcript viewers on the dashboard surface", () => {
  const search = vi.fn();
  expect(terminalSearch.handler({ q: "x" }, { search })).toEqual({ matches: [], sessionsSearched: 0, truncated: false });
  expect(search).not.toHaveBeenCalled();
  expect(terminalPasteImage.input.safeParse({ files: [{ bytes: "not binary", mime: "image/png" }] }).success).toBe(false);
  for (const action of [terminalPasteImage, terminalProposalStream, terminalSearch, terminalTranscript]) {
    expect(action.mcp).toHaveProperty("reason");
  }
});
interface RunResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

function setup(destructive = false, elicitation?: object) {
  const handlers = new Map<string, (input: RunInput) => Promise<RunResult>>();
  const elicitInput = vi.fn().mockResolvedValue({ action: "decline" });
  const dashboard = new DashboardClient("http://localhost:1337");
  const post = vi.spyOn(dashboard, "post").mockResolvedValue({
    proposal: { id: "run-123", destructive, status: "pending" },
  });
  const server = {
    registerTool: (name: string, _schema: unknown, handler: (input: RunInput) => Promise<RunResult>) => {
      handlers.set(name, handler);
    },
    server: { getClientCapabilities: () => ({ elicitation }), elicitInput },
  };
  registerTerminalTools(server as unknown as McpServer, { dashboard } as Context);
  return { run: handlers.get("terminal_propose_run")!, post, elicitInput };
}

it("lists registered dock tabs without changing the no-input tool", async () => {
  const dashboard = new DashboardClient("http://localhost:1447");
  const get = vi.spyOn(dashboard, "get").mockResolvedValue({
    sessions: [{ tabId: 3, sessionId: "fixture-session", label: "Fixture", status: "open", busy: false }],
  });
  let run: () => Promise<RunResult> = async () => { throw new Error("Not registered"); };
  const server = {
    registerTool(name: string, config: unknown, handler: typeof run) {
      if (name === "terminal_list") {
        expect(config).not.toHaveProperty("inputSchema");
        run = handler;
      }
    },
  };
  registerTerminalTools(server as unknown as McpServer, { dashboard } as Context);
  const result = await run();
  expect(result.content[0].text).toContain("#3 · Fixture · open · idle · session=fixture-session");
  expect(get).toHaveBeenCalledExactlyOnceWith("/api/terminal/sessions");
});

it("stops a terminal wait when the MCP request is cancelled", async () => {
  const dashboard = new DashboardClient("http://localhost:1447");
  const get = vi.spyOn(dashboard, "get").mockResolvedValue("still starting\n");
  const handlers = new Map<string, (input: object, extra: { signal: AbortSignal }) => Promise<RunResult>>();
  const server = {
    registerTool: (name: string, _schema: unknown, handler: (input: object, extra: { signal: AbortSignal }) => Promise<RunResult>) => {
      handlers.set(name, handler);
    },
  };
  registerTerminalTools(server as unknown as McpServer, { dashboard } as Context);
  const controller = new AbortController();
  controller.abort();
  const result = await handlers.get("terminal_wait_for")!({ sessionId: "fixture-session", pattern: "ready" }, { signal: controller.signal });
  expect(result.content[0].text).toContain("No match for /ready/");
  expect(get).toHaveBeenCalledExactlyOnceWith("/api/terminal/log", { session: "fixture-session" });
});

it("preserves the MCP terminal tail line limit", async () => {
  const dashboard = new DashboardClient("http://localhost:1447");
  vi.spyOn(dashboard, "get").mockResolvedValue("first\nsecond\nthird\n");
  const handlers = new Map<string, (input: object) => Promise<RunResult>>();
  const server = { registerTool: (name: string, _schema: unknown, handler: (input: object) => Promise<RunResult>) => handlers.set(name, handler) };
  registerTerminalTools(server as unknown as McpServer, { dashboard } as Context);
  const result = await handlers.get("terminal_tail")!({ sessionId: "fixture-session", maxLines: 2 });
  expect(result.content[0].text).toContain("last 2 lines");
  expect(result.content[0].text).toContain("second\nthird");
  expect(result.content[0].text).not.toContain("first");
});

it("reports a denied proposal without implying it ran", async () => {
  const dashboard = new DashboardClient("http://localhost:1447");
  const get = vi.spyOn(dashboard, "get").mockResolvedValue({
    proposal: { id: "fixture", status: "denied", command: "echo fixture", destructive: false },
  });
  const handlers = new Map<string, (input: object) => Promise<RunResult>>();
  const server = { registerTool: (name: string, _schema: unknown, handler: (input: object) => Promise<RunResult>) => handlers.set(name, handler) };
  registerTerminalTools(server as unknown as McpServer, { dashboard } as Context);
  const result = await handlers.get("terminal_proposal_status")!({ id: "fixture" });
  expect(result.content[0].text).toContain("Proposal fixture: denied");
  expect(get).toHaveBeenCalledExactlyOnceWith("/api/terminal/propose", { id: "fixture" });
});

describe("terminal_propose_run", () => {
  it.each([{}, undefined])("queues automatic execution without client elicitation (%s)", async (capability) => {
    const { run, post, elicitInput } = setup(false, capability);
    const input: RunInput = { command: "npm run ios", cwd: "/Users/test/task-worktree", kind: "upstart", label: "app iOS" };
    const result = await run(input);
    expect(elicitInput).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith("/api/terminal/propose", expect.objectContaining({
      ...input, source: "mcp", autoRunConfirmed: true,
    }));
    expect(result.content[0].text).toContain("Queued for automatic launch");
    expect(result.content[0].text).not.toContain("User confirmed");
  });

  it("automatically queues destructive commands without human approval", async () => {
    const { run } = setup(true);
    const result = await run({ command: "rm -rf /tmp/example" });
    expect(result.content[0].text).not.toContain("waiting for confirmation");
    expect(result.content[0].text).toContain("Queued for automatic launch");
  });

  it("surfaces dashboard failures rather than reporting a decline", async () => {
    const { run, post } = setup();
    post.mockRejectedValueOnce(new Error("dashboard unavailable"));
    const result = await run({ command: "npm test" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("dashboard unavailable");
  });
});
