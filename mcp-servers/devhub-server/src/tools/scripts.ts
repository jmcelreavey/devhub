import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import { withDashboardErrors } from "../dashboard-client.ts";

interface CatalogEntry {
  id: string;
  label: string;
  description: string;
  mutates: boolean;
  effects: string[];
  cmd: string;
}

interface RunPayload {
  runId: string;
  script: string;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number;
  lines: string[];
}

function tail(lines: string[], n = 20): string {
  return lines.length > n ? `… (${lines.length - n} earlier lines)\n${lines.slice(-n).join("\n")}` : lines.join("\n");
}

export function registerScriptsTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;

  server.registerTool(
    "scripts_list",
    {
      description:
        "List the DevHub Ops/Actions scripts that can be run via scripts_run (sync skills/agents/mcp, update & sync, commit & push, pull core, validate, etc.), with which ones mutate state. Requires the dashboard running.",
    },
    async () =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<{ catalog: CatalogEntry[] }>("/api/scripts");
        const lines = data.catalog.map(
          (c) => `- ${c.id}${c.mutates ? " ⚠ mutates" : ""} — ${c.description}`,
        );
        return {
          content: [
            {
              type: "text",
              text: `Scripts (${data.catalog.length}). Run with scripts_run; ⚠ mutating ones need confirm:true.\n${lines.join("\n")}`,
            },
          ],
        };
      }),
  );

  server.registerTool(
    "scripts_run",
    {
      description:
        "Run a DevHub Ops/Actions script by id (see scripts_list). Mutating scripts require confirm:true. Returns a runId — poll scripts_run_status for output. Requires the dashboard running.",
      inputSchema: {
        script: z.string().describe("Script id from scripts_list, e.g. sync_skills, update_and_sync, commit_dirty_push"),
        confirm: z.boolean().optional().describe("Required (true) for scripts that mutate state"),
        commitMessage: z.string().optional().describe("Commit message (for commit_dirty_push)"),
        prune: z.boolean().optional().describe("Prune removed items (for sync_skills/agents/mcp_servers)"),
      },
    },
    async ({ script, confirm, commitMessage, prune }) =>
      withDashboardErrors(async () => {
        const { catalog } = await dashboard.get<{ catalog: CatalogEntry[] }>("/api/scripts");
        const entry = catalog.find((c) => c.id === script);
        if (!entry) {
          return {
            content: [
              {
                type: "text",
                text: `Unknown script "${script}". Valid ids: ${catalog.map((c) => c.id).join(", ")}`,
              },
            ],
            isError: true,
          };
        }
        if (entry.mutates && !confirm) {
          return {
            content: [
              {
                type: "text",
                text: `"${script}" mutates state and needs confirmation. Effects:\n${entry.effects
                  .map((e) => `  - ${e}`)
                  .join("\n")}\nRe-run with confirm: true.`,
              },
            ],
            isError: true,
          };
        }
        const body: Record<string, unknown> = { script };
        if (commitMessage) body.commitMessage = commitMessage;
        if (typeof prune === "boolean") body.prune = prune;
        const started = await dashboard.post<{ runId: string }>("/api/scripts", body);
        // One quick status read so the caller gets immediate feedback.
        let status: RunPayload | null = null;
        try {
          await new Promise((r) => setTimeout(r, 1200));
          status = await dashboard.get<RunPayload>(`/api/scripts/runs/${started.runId}`);
        } catch {
          /* run log may not be queryable yet — that's fine */
        }
        const head = `Started "${script}" — runId ${started.runId}. Poll scripts_run_status for full output.`;
        const preview = status?.lines?.length ? `\n\nSo far:\n${tail(status.lines, 12)}` : "";
        const done =
          status && status.exitCode !== undefined ? `\n\n(finished, exit ${status.exitCode})` : "";
        return { content: [{ type: "text", text: `${head}${preview}${done}` }] };
      }),
  );

  server.registerTool(
    "scripts_run_status",
    {
      description: "Get the output and status of a script run started by scripts_run. Requires the dashboard running.",
      inputSchema: {
        runId: z.string().describe("Run id returned by scripts_run"),
        tailLines: z.number().optional().describe("How many trailing output lines to show (default 30)"),
      },
    },
    async ({ runId, tailLines }) =>
      withDashboardErrors(async () => {
        const run = await dashboard.get<RunPayload>(`/api/scripts/runs/${encodeURIComponent(runId)}`);
        const state =
          run.exitCode === undefined ? "running" : run.exitCode === 0 ? "done (exit 0)" : `failed (exit ${run.exitCode})`;
        return {
          content: [
            { type: "text", text: `${run.script} — ${state}\n\n${tail(run.lines ?? [], tailLines ?? 30)}` },
          ],
        };
      }),
  );

  server.registerTool(
    "scripts_history",
    {
      description: "List recent DevHub script runs (id, script, exit code). Requires the dashboard running.",
    },
    async () =>
      withDashboardErrors(async () => {
        const runs = await dashboard.get<
          Array<{ runId: string; script: string; startedAt: number; finishedAt?: number; exitCode?: number }>
        >("/api/scripts/history");
        if (runs.length === 0) {
          return { content: [{ type: "text", text: "No script run history." }] };
        }
        const lines = runs.map((r) => {
          const when = new Date(r.startedAt).toISOString().replace("T", " ").slice(0, 16);
          const code = r.exitCode === undefined ? "running" : `exit ${r.exitCode}`;
          return `- ${when}  ${r.script}  (${code})  ${r.runId}`;
        });
        return { content: [{ type: "text", text: `Recent runs:\n${lines.join("\n")}` }] };
      }),
  );
}
