import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  scriptsHistory, scriptsList, scriptsRun, scriptsRunStatus,
  type ScriptCatalogValue, type ScriptHistoryEntry, type ScriptRunPayload,
} from "../../../../packages/shared/actions/scripts.ts";
import { registerAction } from "../actions/register.ts";
import { dashboardActionRequest } from "../actions/request.ts";
import type { Context } from "../context.ts";

function tail(lines: string[], count = 20): string {
  return lines.length > count ? `… (${lines.length - count} earlier lines)\n${lines.slice(-count).join("\n")}` : lines.join("\n");
}

function textResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

export function registerScriptsTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;
  const catalog = () => dashboardActionRequest(() => dashboard.get<ScriptCatalogValue>("/api/scripts"));
  registerAction(server, scriptsList, { list: catalog }, (result) => {
    if (!result.ok) return textResult(result.error, true);
    const entries = result.value.catalog;
    const lines = entries.map((entry) => `- ${entry.id}${entry.mutates ? " ⚠ mutates" : ""} — ${entry.description}`);
    return textResult(`Scripts (${entries.length}). Run with scripts_run; ⚠ mutating ones need confirm:true.\n${lines.join("\n")}`);
  });

  registerAction(server, scriptsRun, {
    requireConfirmation: true,
    catalog,
    run: (input) => dashboardActionRequest(async () => {
      const body: Record<string, unknown> = { script: input.script };
      if (input.commitMessage) body.commitMessage = input.commitMessage;
      if (typeof input.prune === "boolean") body.prune = input.prune;
      const started = await dashboard.post<{ runId: string }>("/api/scripts", body);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const status = await dashboardActionRequest(() => dashboard.get<ScriptRunPayload>(`/api/scripts/runs/${started.runId}`));
      return { ...started, script: input.script, status: status.ok ? status.value : null };
    }),
  }, (result) => {
    if (!result.ok) return textResult(result.error, true);
    const { script, runId, status } = result.value;
    const head = `Started "${script}" — runId ${runId}. Poll scripts_run_status for full output.`;
    const preview = status?.lines?.length ? `\n\nSo far:\n${tail(status.lines, 12)}` : "";
    const done = status && status.exitCode !== undefined ? `\n\n(finished, exit ${status.exitCode})` : "";
    return textResult(`${head}${preview}${done}`);
  });

  registerAction(server, scriptsRunStatus, {
    read: (runId) => dashboardActionRequest(() => dashboard.get<ScriptRunPayload>(`/api/scripts/runs/${encodeURIComponent(runId)}`)),
  }, (result) => {
    if (!result.ok) return textResult(result.error, true);
    const { run, tailLines } = result.value;
    const state = run.exitCode === undefined ? "running" : run.exitCode === 0 ? "done (exit 0)" : `failed (exit ${run.exitCode})`;
    return textResult(`${run.script} — ${state}\n\n${tail(run.lines ?? [], tailLines ?? 30)}`);
  });

  registerAction(server, scriptsHistory, {
    read: () => dashboardActionRequest(() => dashboard.get<ScriptHistoryEntry[]>("/api/scripts/history")),
  }, (result) => {
    if (!result.ok) return textResult(result.error, true);
    if (!result.value.length) return textResult("No script run history.");
    const lines = result.value.map((run) => {
      const when = new Date(run.startedAt).toISOString().replace("T", " ").slice(0, 16);
      const code = run.exitCode === undefined ? "running" : `exit ${run.exitCode}`;
      return `- ${when}  ${run.script}  (${code})  ${run.runId}`;
    });
    return textResult(`Recent runs:\n${lines.join("\n")}`);
  });
}
