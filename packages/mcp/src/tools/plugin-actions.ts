import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { pluginActionList, pluginActionReview, pluginActionRun, pluginActionStatus } from "../../../../packages/shared/actions/plugin-actions.ts";
import { registerAction } from "../actions/register.ts";
import type { Context } from "../context.ts";
import { withDashboardErrors } from "../dashboard-client.ts";

const streamEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("output"), text: z.string() }),
  z.object({ type: z.literal("progress"), text: z.string(), current: z.number().optional(), total: z.number().optional() }),
  z.object({ type: z.literal("result"), result: z.object({ ok: z.boolean() }).passthrough() }),
  z.object({ type: z.literal("error"), error: z.string() }),
]);

export function registerPluginActionTools(server: McpServer, ctx: Context): void {
  const request = (name: string, path: string, method: "GET" | "POST", body?: unknown, timeoutMs = 60_000) => ctx.dashboard.post<unknown>(`/api/plugins/runtime/${name}`, { kind: "api", path, method, ...(body === undefined ? {} : { body }) }, timeoutMs);
  const result = (data: unknown) => {
    const value = data && typeof data === "object" && "result" in data ? data.result : data;
    return { content: [{ type: "text" as const, text: JSON.stringify(value) }], ...(value && typeof value === "object" && "ok" in value && value.ok === false ? { isError: true } : {}) };
  };
  const response = (value: unknown) => value as CallToolResult;

  registerAction(server, pluginActionList, {
    run: ({ plugin, kind }) => withDashboardErrors(async () => result(await request(plugin, "/" + kind, "GET"))),
  }, response);
  registerAction(server, pluginActionReview, {
    run: ({ plugin, input }) => withDashboardErrors(async () => result(await request(plugin, "/actions/review", "POST", input))),
  }, response);
  registerAction(server, pluginActionRun, {
    refuse: () => ({ isError: true, content: [{ type: "text", text: "Pass confirm: true to execute the validated action immediately." }] }),
    run: async ({ plugin, token }) => {
      const output = await withDashboardErrors(async () => {
        const data = await request(plugin, "/actions/execute", "POST", { token }, 900_000);
        const records: unknown[] = typeof data === "string" ? data.trim().split("\n").map((line) => JSON.parse(line)) : [data];
        const events = records.map((record) => streamEvent.parse(record));
        const failure = events.find((event) => event.type === "error");
        if (failure) throw new Error(failure.error);
        const finished = events.filter((event) => event.type === "result").at(-1);
        if (!finished) return { isError: true, content: [{ type: "text", text: "Plugin execution outcome is unknown. Check its recorded runs and the destination before reviewing another action. Do not retry this token." }] };
        const progress = events.filter((event) => event.type === "output" || event.type === "progress").map((event) => event.text ?? "").join("\n");
        const receipt = result(finished.result);
        return { ...receipt, content: [{ type: "text", text: progress + (progress ? "\n" : "") + receipt.content[0].text }] };
      });
      if (output.isError) output.content.push({ type: "text", text: "Do not automatically retry this action. Check recorded runs and the destination for a possible unknown outcome before requesting another review." });
      return output;
    },
  }, response);
  registerAction(server, pluginActionStatus, {
    run: ({ plugin, runId }) => withDashboardErrors(async () => result(await request(plugin, "/runs/status", "POST", { runId }))),
  }, response);
}
