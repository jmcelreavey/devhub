import { recall, recallGraph, recallRemember, recallIndex } from "../../../../packages/shared/actions/recall.ts";
import { registerAction } from "../actions/register.ts";
import type { DashboardToolResult } from "../dashboard-client.ts";
/**
 * Recall tools — the ones an agent should reach for first.
 *
 * `search` (and `notes_search`) answer "which files contain these words".
 * `recall` answers "what do I already know about this", which is the question
 * an agent actually has at the start of a task. The difference is not cosmetic:
 * search returns whole files ranked by keyword overlap, recall returns
 * budgeted, ranked, cited passages drawn from notes, docs, tasks and the event
 * spine together, so the answer can come from a commit message and a note from
 * March at the same time.
 *
 * Dashboard-backed on purpose. The index lives next to the notes vault and the
 * dashboard process already owns that tree; duplicating the retrieval stack in
 * the MCP server would mean two implementations of ranking that drift.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../context.ts";
import { withDashboardErrors } from "../dashboard-client.ts";
import { listWidgetHtml, uiResult } from "../ui.ts";

interface RecallManifest {
  builtAt: string;
  chunkCount: number;
  bySource: Record<string, number>;
  embedder: string;
  tookMs: number;
}

export function registerRecallTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;

  registerAction(server, recall, { execute: async ({ query, budgetTokens, limit, kinds, alpha }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<{ markdown?: string; result?: { hits?: unknown[] } }>(
          "/api/recall",
          {
            q: query,
            budget: budgetTokens,
            limit,
            alpha,
            kinds: kinds?.join(","),
            format: "markdown",
          },
        );
        const markdown = data.markdown ?? `No recall hits for "${query}".`;
        const hits = (data.result?.hits ?? []) as Array<{
          chunk?: { title?: string; sourceKind?: string };
        }>;
        const items = hits.map((hit) => ({
          label: hit.chunk?.title || "(untitled)",
          meta: hit.chunk?.sourceKind,
        }));
        const html = items.length
          ? listWidgetHtml("Recall", `${items.length} passages for ${query}`, items)
          : null;
        return uiResult(markdown, html, `ui://devhub/recall/${encodeURIComponent(query)}`);
      }) },
    (result) => result as DashboardToolResult);

  registerAction(server, recallGraph, { execute: async ({ entity, minWeight }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<{
          entity?: { key: string; mentions: number } | null;
          neighbours?: Array<{ node: { key: string; mentions: number }; weight: number; evidence: string[] }>;
          nodes?: Array<{ key: string; mentions: number }>;
          edges?: Array<{ from: string; to: string; weight: number }>;
          totalNodes?: number;
        }>("/api/recall/graph", { entity, minWeight });

        if (entity) {
          const rows = data.neighbours ?? [];
          if (rows.length === 0) {
            return { content: [{ type: "text", text: `No derived edges for \`${entity}\`.` }] };
          }
          const body = rows
            .map((row) => `- \`${row.node.key}\` — weight ${row.weight}, seen in ${row.evidence.length} chunk(s)`)
            .join("\n");
          return {
            content: [
              {
                type: "text",
                text: `Related to \`${entity}\` (${data.entity?.mentions ?? 0} mentions):\n\n${body}`,
              },
            ],
          };
        }

        const nodes = data.nodes ?? [];
        const top = nodes
          .slice(0, 40)
          .map((node) => `- \`${node.key}\` (${node.mentions})`)
          .join("\n");
        return {
          content: [
            {
              type: "text",
              text: `${data.totalNodes ?? nodes.length} entities, ${data.edges?.length ?? 0} edges. Most mentioned:\n\n${top}`,
            },
          ],
        };
      }) },
    (result) => result as DashboardToolResult);

  registerAction(server, recallRemember, { execute: async ({ title, body, kind, source, url, id }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.post<{ written?: number; skipped?: number }>(
          "/api/recall/events",
          { kind: kind ?? "decision", title, body, source: source ?? "mcp", url, id },
        );
        if ((data.written ?? 0) === 0) {
          return { content: [{ type: "text", text: `Already recorded (id \`${id}\`) — nothing written.` }] };
        }
        return { content: [{ type: "text", text: `Recorded: ${title}` }] };
      }) },
    (result) => result as DashboardToolResult);

  registerAction(server, recallIndex, { execute: async ({ rebuild, ingest }) =>
      withDashboardErrors(async () => {
        if (ingest) {
          const result = await dashboard.post<{
            written?: number;
            results?: Array<{ source: string; written: number; skipped: number }>;
          }>("/api/recall/ingest", { allRepos: true, reindex: true });
          const lines = (result.results ?? [])
            .map((r) => `- ${r.source}: ${r.written} new, ${r.skipped} known`)
            .join("\n");
          return {
            content: [{ type: "text", text: `Ingested ${result.written ?? 0} event(s).\n\n${lines}` }],
          };
        }

        if (rebuild) {
          const result = await dashboard.post<{ manifest?: RecallManifest }>("/api/recall/index", {});
          const m = result.manifest;
          if (!m) return { content: [{ type: "text", text: "Rebuild returned no manifest." }], isError: true };
          const bySource = Object.entries(m.bySource)
            .map(([kind, count]) => `${kind} ${count}`)
            .join(", ");
          return {
            content: [
              { type: "text", text: `Rebuilt: ${m.chunkCount} chunks (${bySource}) in ${m.tookMs}ms.` },
            ],
          };
        }

        const status = await dashboard.get<{
          manifest: RecallManifest | null;
          stale: boolean;
          events: number;
        }>("/api/recall/index");

        if (!status.manifest) {
          return {
            content: [{ type: "text", text: "Index not built yet. Call again with `rebuild: true`." }],
          };
        }
        const m = status.manifest;
        const bySource = Object.entries(m.bySource)
          .map(([kind, count]) => `${kind} ${count}`)
          .join(", ");
        return {
          content: [
            {
              type: "text",
              text: [
                `Chunks: ${m.chunkCount} (${bySource})`,
                `Events: ${status.events}`,
                `Built: ${m.builtAt}${status.stale ? " (stale — sources changed since)" : ""}`,
                `Embedder: ${m.embedder}`,
              ].join("\n"),
            },
          ],
        };
      }) },
    (result) => result as DashboardToolResult);
}
