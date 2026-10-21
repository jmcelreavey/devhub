import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import { withDashboardErrors } from "../dashboard-client.ts";

const plugin = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/);

const streamEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("output"), text: z.string() }),
  z.object({ type: z.literal("result"), result: z.object({ ok: z.boolean() }).passthrough() }),
  z.object({ type: z.literal("error"), error: z.string() }),
]);

export function registerPluginActionTools(server: McpServer, ctx: Context): void {
  const request = (name: string, path: string, method: "GET" | "POST", body?: unknown, timeoutMs = 60_000) => ctx.dashboard.post<unknown>(`/api/plugins/runtime/${name}`, { kind: "api", path, method, ...(body === undefined ? {} : { body }) }, timeoutMs);
  const result = (data: unknown) => {
    const value = data && typeof data === "object" && "result" in data ? data.result : data;
    return { content: [{ type: "text" as const, text: JSON.stringify(value) }], ...(value && typeof value === "object" && "ok" in value && value.ok === false ? { isError: true } : {}) };
  };
  server.registerTool("plugins_action_list", {
    description: "List actions or recorded runs from an enabled, reviewed request-worker plugin. Only the declared /actions or /runs route is reachable; no source-route or command fallback.",
    inputSchema: { plugin, kind: z.enum(["actions", "runs"]) },
  }, async ({ plugin: name, kind }) => withDashboardErrors(async () => result(await request(name, "/" + kind, "GET"))));
  server.registerTool("plugins_action_review", {
    description: "Review an action through an enabled plugin's declared /actions/review route. The plugin validates its input and policy and returns the exact action, warning and expiring single-use token. Nothing executes here. Local plugin-management access is required.",
    inputSchema: { plugin, input: z.record(z.string().max(128), z.unknown()).refine((value) => Buffer.byteLength(JSON.stringify(value)) <= 32_768, "Action input is too large") },
  }, async ({ plugin: name, input }) => withDashboardErrors(async () => result(await request(name, "/actions/review", "POST", input))));
  server.registerTool("plugins_action_run", {
    description: "Execute one validated plugin action immediately with confirm:true. No human approval is required. Token expiry, single-use consumption and state rechecks belong to the plugin. Returns worker output after completion; an unknown outcome must be checked at the destination, never automatically retried.",
    inputSchema: { plugin, token: z.string().uuid(), confirm: z.boolean().optional() },
  }, async ({ plugin: name, token, confirm }) => {
    if (confirm !== true) return { isError: true, content: [{ type: "text", text: "Pass confirm: true to execute the validated action immediately." }] };
    const response = await withDashboardErrors(async () => {
      const data = await request(name, "/actions/execute", "POST", { token }, 900_000);
      const records: unknown[] = typeof data === "string" ? data.trim().split("\n").map((line) => JSON.parse(line)) : [data];
      const events = records.map((record) => streamEvent.parse(record));
      const failure = events.find((event) => event.type === "error");
      if (failure) throw new Error(failure.error);
      const finished = events.filter((event) => event.type === "result").at(-1);
      if (!finished) return { isError: true, content: [{ type: "text", text: "Plugin execution outcome is unknown. Check its recorded runs and the destination before reviewing another action. Do not retry this token." }] };
      const output = events.filter((event) => event.type === "output").map((event) => event.text ?? "").join("\n");
      const receipt = result(finished.result);
      return { ...receipt, content: [{ type: "text", text: output + (output ? "\n" : "") + receipt.content[0].text }] };
    });
    if (response.isError) response.content.push({ type: "text", text: "Do not automatically retry this action. Check recorded runs and the destination for a possible unknown outcome before requesting another review." });
    return response;
  });
  server.registerTool("plugins_action_status", {
    description: "Read a recorded action outcome through an enabled plugin's declared /runs/status route. Never starts, cancels or retries a command.",
    inputSchema: { plugin, runId: z.string().uuid() },
  }, async ({ plugin: name, runId }) => withDashboardErrors(async () => result(await request(name, "/runs/status", "POST", { runId }))));
}
