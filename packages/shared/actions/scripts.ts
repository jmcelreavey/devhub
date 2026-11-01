import { z } from "zod";
import { defineAction } from "./define.ts";
import type { ActionResult } from "./result.ts";

export interface ScriptCatalogEntry {
  id: string;
  label: string;
  description: string;
  mutates: boolean;
  effects: string[];
  cmd: string;
}

export interface ScriptRunPayload {
  runId: string;
  script: string;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number;
  lines: string[];
}

export interface ScriptHistoryEntry {
  runId: string;
  script: string;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number;
}

export interface ScriptCatalogValue {
  scripts?: string[];
  catalog: ScriptCatalogEntry[];
}

export const scriptsListInput = z.object({}).meta({ additionalProperties: false });
export const scriptsRunInput = z.object({
  script: z.string().describe("Script id from scripts_list, e.g. sync_skills, update_and_sync, commit_dirty_push"),
  confirm: z.boolean().optional().describe("Required (true) for scripts that mutate state"),
  commitMessage: z.string().optional().describe("Commit message (for commit_dirty_push)"),
  prune: z.boolean().optional().describe("Prune removed items (for sync_skills/agents/mcp_servers)"),
}).meta({ additionalProperties: false });
export const scriptsRunStatusInput = z.object({
  runId: z.string().describe("Run id returned by scripts_run"),
  tailLines: z.number().optional().describe("How many trailing output lines to show (default 30)"),
}).meta({ additionalProperties: false });
export const scriptsHistoryInput = z.object({}).meta({ additionalProperties: false });

export interface ScriptsListContext { list: () => Promise<ActionResult<ScriptCatalogValue>> }
export interface ScriptsRunContext {
  requireConfirmation: boolean;
  catalog: () => Promise<ActionResult<ScriptCatalogValue>>;
  run: (input: Omit<z.output<typeof scriptsRunInput>, "confirm">) => Promise<ActionResult<{ runId: string; script: string; status?: ScriptRunPayload | null }>>;
}
export interface ScriptsRunStatusContext { read: (runId: string) => Promise<ActionResult<ScriptRunPayload>> }
export interface ScriptsHistoryContext { read: () => Promise<ActionResult<ScriptHistoryEntry[]>> }

export const scriptsList = defineAction<typeof scriptsListInput, ScriptsListContext, ActionResult<ScriptCatalogValue>>({
  input: scriptsListInput,
  http: { method: "GET", path: "/api/scripts" },
  mcp: { name: "scripts_list", toolset: "scripts", description: "List the DevHub Ops/Actions scripts that can be run via scripts_run (sync skills/agents/mcp, update & sync, commit & push, pull core, validate, etc.), with which ones mutate state. Requires the dashboard running." },
  handler: (_, context) => context.list(),
});

export const scriptsRun = defineAction<typeof scriptsRunInput, ScriptsRunContext, ActionResult<{ runId: string; script: string; status?: ScriptRunPayload | null }>>({
  input: scriptsRunInput,
  http: { method: "POST", path: "/api/scripts" },
  mcp: { name: "scripts_run", toolset: "scripts", description: "Run a DevHub Ops/Actions script by id (see scripts_list). Mutating scripts require confirm:true. Returns a runId — poll scripts_run_status for output. Requires the dashboard running." },
  handler: async ({ confirm, ...input }, context) => {
    if (context.requireConfirmation) {
      const result = await context.catalog();
      if (!result.ok) return result;
      const entry = result.value.catalog.find((item) => item.id === input.script);
      if (!entry) return { ok: false, error: `Unknown script "${input.script}". Valid ids: ${result.value.catalog.map((item) => item.id).join(", ")}`, status: 400 };
      if (entry.mutates && !confirm) {
        return { ok: false, error: `"${input.script}" mutates state and needs confirmation. Effects:\n${entry.effects.map((effect) => `  - ${effect}`).join("\n")}\nRe-run with confirm: true.`, status: 403 };
      }
    }
    return context.run(input);
  },
});

export const scriptsRunStatus = defineAction<typeof scriptsRunStatusInput, ScriptsRunStatusContext, ActionResult<{ run: ScriptRunPayload; tailLines?: number }>>({
  input: scriptsRunStatusInput,
  http: { method: "GET", path: "/api/scripts/runs/[runId]" },
  mcp: { name: "scripts_run_status", toolset: "scripts", description: "Get the output and status of a script run started by scripts_run. Requires the dashboard running." },
  handler: async ({ runId, tailLines }, context) => {
    const result = await context.read(runId);
    return result.ok ? { ok: true, value: { run: result.value, tailLines } } : result;
  },
});

export const scriptsHistory = defineAction<typeof scriptsHistoryInput, ScriptsHistoryContext, ActionResult<ScriptHistoryEntry[]>>({
  input: scriptsHistoryInput,
  http: { method: "GET", path: "/api/scripts/history" },
  mcp: { name: "scripts_history", toolset: "scripts", description: "List recent DevHub script runs (id, script, exit code). Requires the dashboard running." },
  handler: (_, context) => context.read(),
});

export const scriptsRunsInput = z.object({ limit: z.number() });
export const scriptsRuns = defineAction<typeof scriptsRunsInput, { read: (limit: number) => unknown }, unknown>({
  input: scriptsRunsInput,
  http: { method: "GET", path: "/api/scripts/runs" },
  mcp: { reason: "This dashboard audit view has different limits, ordering and enriched rows from scripts_history." },
  handler: ({ limit }, context) => context.read(limit),
});

export const scriptsStreamInput = z.object({ runId: z.string() });
export const scriptsStream = defineAction<typeof scriptsStreamInput, { stream: (runId: string) => unknown }, unknown>({
  input: scriptsStreamInput,
  http: { method: "GET", path: "/api/scripts/stream/[runId]" },
  mcp: { reason: "Live server-sent events are a dashboard streaming transport; MCP uses scripts_run_status to poll." },
  handler: ({ runId }, context) => context.stream(runId),
});
