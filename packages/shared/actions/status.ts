import { z } from "zod";
import { defineAction } from "./define.ts";

export const statusServicesInput = z.object({});
export interface StatusServicesContext { read: (input: z.output<typeof statusServicesInput>) => Promise<Record<string, { active: boolean; uptime: string | null }>> | Record<string, { active: boolean; uptime: string | null }> }
export const statusServices = defineAction<typeof statusServicesInput, StatusServicesContext, Record<string, { active: boolean; uptime: string | null }>>({
  input: statusServicesInput,
  http: { method: "GET", path: "/api/status/services" },
  mcp: { name: "status_services", toolset: "status", description: "Whether the Agents (Paseo) daemon behind the dashboard is answering. Requires the dashboard running." },
  handler: (input, context) => context.read(input),
});

export const statusExecInput = z.object({});
export interface StatusExecData {
  inFlight: { command: string; label?: string; runningMs: number; timeoutMs: number; overdue: boolean; cwd?: string }[];
  slowest: { command: string; label?: string; durationMs: number; ok: boolean; timedOut: boolean }[];
}
export interface StatusExecContext { read: () => StatusExecData | Promise<StatusExecData> }
export const statusExec = defineAction<typeof statusExecInput, StatusExecContext, StatusExecData>({
  input: statusExecInput,
  http: { method: "GET", path: "/api/status/exec" },
  mcp: { name: "status_exec", toolset: "status", description: "External commands the dashboard is running right now, plus the slowest recent ones. Use this FIRST when the dashboard is hanging, a page never loads, or a request is slow: a call with a large runningMs — especially one marked overdue — is what is blocking. Covers git and gh subprocesses. Requires the dashboard running (if it does not answer at all, the server itself is wedged)." },
  handler: (_input, context) => context.read(),
});

export const statusLogsInput = z.object({
  source: z.enum(["all", "shell", "sidecar", "renderer"]).optional().describe("Log to read (default all)"),
  lines: z.number().int().min(1).max(1000).optional().describe("Most recent lines to return (default 150)"),
  filter: z.string().trim().min(1).max(200).optional().describe("Only lines containing this text"),
}).meta({ additionalProperties: false });
export interface StatusLogsData { logDir: string; lines: { raw: string }[]; count?: number }
export interface StatusLogsContext { read: (input: { source: "all" | "shell" | "sidecar" | "renderer"; lines: number }) => StatusLogsData | Promise<StatusLogsData> }
export const statusLogs = defineAction<typeof statusLogsInput, StatusLogsContext, { data: StatusLogsData; filter?: string }>({
  input: statusLogsInput,
  http: { method: "GET", path: "/api/status/logs" },
  mcp: { name: "status_logs", toolset: "status", description: "Tail the DevHub desktop logs (shell = Tauri, sidecar = the dashboard server, renderer = the webview), merged in time order. Use after status_exec when an error is not a hang: startup failures, crashes, sidecar restarts. filter keeps lines containing the text (case-insensitive). Requires the dashboard running." },
  handler: async ({ source = "all", lines = 150, filter }, context) => {
    const data = await context.read({ source, lines: filter ? 1000 : lines });
    const needle = filter?.toLowerCase();
    const matched = needle ? data.lines.filter((line) => line.raw.toLowerCase().includes(needle)) : data.lines;
    return { data: { ...data, lines: matched.slice(-lines) }, filter };
  },
});

export const statusGitInput = z.object({ scope: z.string().optional() });
export interface StatusGitContext { read: (input: z.output<typeof statusGitInput>) => Promise<unknown> | unknown }
export const statusGit = defineAction<typeof statusGitInput, StatusGitContext, unknown>({
  input: statusGitInput,
  http: { method: "GET", path: "/api/status/git" },
  mcp: { name: "status_git", toolset: "status", description: "Git status of the DevHub repo: dirty/syncable content (notes, tasks, docs), unpushed commits, and merge conflicts. Requires the dashboard running." },
  handler: (input, context) => context.read(input),
});

export const statusMcpInput = z.object({});
export interface StatusMcpResult {
  servers: Array<{ name: string; runningCount: number; pids: number[]; binaryExists: boolean }>;
}
export interface StatusMcpContext { read: (input: z.output<typeof statusMcpInput>) => Promise<StatusMcpResult> | StatusMcpResult }
export const statusMcp = defineAction<typeof statusMcpInput, StatusMcpContext, StatusMcpResult>({
  input: statusMcpInput,
  http: { method: "GET", path: "/api/status/mcp" },
  mcp: { name: "status_mcp", toolset: "status", description: "Runtime status of the configured MCP servers: which are running, PIDs, and whether their binary exists. Requires the dashboard running." },
  handler: (input, context) => context.read(input),
});


interface StatusLocalContext { read: () => unknown }
function localStatus(path: string, method: "GET" | "POST", reason: string) {
  return defineAction({ input: z.object({}), http: { method, path }, mcp: { reason }, handler: (_input, context: StatusLocalContext) => context.read() });
}
export const statusPackagedCheckout = localStatus("/api/status/packaged-checkout", "GET", "Unauthenticated desktop capability probe used by the stale-bundle banner.");
export const statusRebuildCapability = localStatus("/api/status/dashboard/rebuild", "GET", "Unauthenticated capability probe used while the dashboard restarts.");
export const statusRebuild = localStatus("/api/status/dashboard/rebuild", "POST", "Explicit browser-origin-guarded local rebuild; never an agent restart endpoint.");
