import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type { Context } from "../context.ts";
import { DashboardClient } from "../dashboard-client.ts";
import { registerTerminalTools } from "./terminal.ts";

interface RunInput {
  command: string;
  cwd?: string;
  kind?: "upstart";
  label?: string;
}
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

  it("reports the dashboard destructive-command confirmation without claiming execution", async () => {
    const { run } = setup(true);
    const result = await run({ command: "rm -rf /tmp/example" });
    expect(result.content[0].text).toContain("waiting for confirmation");
    expect(result.content[0].text).not.toContain("Queued for automatic launch");
  });

  it("surfaces dashboard failures rather than reporting a decline", async () => {
    const { run, post } = setup();
    post.mockRejectedValueOnce(new Error("dashboard unavailable"));
    const result = await run({ command: "npm test" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("dashboard unavailable");
  });
});
