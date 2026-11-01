import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { expect, it, vi } from "vitest";
import { sessionRecapInput } from "../../../../packages/shared/actions/sessions.ts";
import type { Context } from "../context.ts";
import { DashboardClient, DashboardHttpError, type DashboardToolResult } from "../dashboard-client.ts";
import { registerSessionTools } from "./sessions.ts";

it("keeps recap query mapping and conflict errors", async () => {
  const dashboard = new DashboardClient("http://localhost:1447");
  const get = vi.spyOn(dashboard, "get").mockResolvedValueOnce({ sessions: [] });
  let run: (input: unknown) => Promise<DashboardToolResult> = async () => { throw new Error("Not registered"); };
  const server = {
    registerTool(name: string, config: { inputSchema?: unknown }, handler: typeof run) {
      if (name === "sessions_recap") {
        expect(config.inputSchema).toBe(sessionRecapInput);
        run = handler;
      }
    },
  };
  registerSessionTools(server as unknown as McpServer, { dashboard } as Context);
  expect((await run({ sessionId: "s1", includeChildren: true })).content[0]).toMatchObject({ text: '{"sessions":[]}' });
  expect(get).toHaveBeenCalledWith("/api/opencode/recap", { sessionId: "s1", children: true, directory: undefined });
  get.mockRejectedValueOnce(new DashboardHttpError(409, { error: "Choose a session." }, "Conflict"));
  expect(await run({})).toMatchObject({ isError: true, content: [{ text: "Choose a session." }] });
});
