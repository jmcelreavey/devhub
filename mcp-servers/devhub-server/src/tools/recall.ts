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
import { z } from "zod";
import type { Context } from "../context.ts";
import { withDashboardErrors } from "../dashboard-client.ts";

interface RecallManifest {
  builtAt: string;
  chunkCount: number;
  bySource: Record<string, number>;
  embedder: string;
  tookMs: number;
}

export function registerRecallTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;

  server.registerTool(
    "recall",
    {
      description:
        "Ranked, token-budgeted, cited context from everything DevHub knows — notes, learnings, docs, task history and the event spine (commits, PRs, runs, sessions). Use this BEFORE starting work on a topic, ticket or repo, and prefer it over `search` when the question is 'what do I already know about X' rather than 'which file contains the string X'.",
      inputSchema: {
        query: z
          .string()
          .describe("Natural language question, ticket key, repo name, or error message"),
        budgetTokens: z
          .number()
          .optional()
          .describe("Token budget for the assembled context (default 2000). Hits are packed by score until spent."),
        limit: z.number().optional().describe("Max passages (default 12)"),
        kinds: z
          .array(z.enum(["note", "learning", "doc", "task", "event", "diagram"]))
          .optional()
          .describe("Restrict to these sources"),
        alpha: z
          .number()
          .optional()
          .describe("0 = pure keyword, 1 = pure vector, default 0.5. Use 0.2 for exact identifiers, 0.8 for vague recall."),
      },
    },
    async ({ query, budgetTokens, limit, kinds, alpha }) =>
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
        return { content: [{ type: "text", text: markdown }] };
      }),
  );

  server.registerTool(
    "recall_graph",
    {
      description:
        "Derived entity graph — what turns up alongside a ticket, PR, repo or note across all indexed content. Unlike `entity_links_read`, which only sees hand-written ## Links sections, these edges are derived from co-occurrence and exist without anyone having typed them. Omit `entity` for the whole graph.",
      inputSchema: {
        entity: z
          .string()
          .optional()
          .describe("Entity key, e.g. `jira:PTF-3774`, `repo:devhub`, `pr:owner/repo#525`"),
        minWeight: z.number().optional().describe("Drop edges below this co-occurrence count"),
      },
    },
    async ({ entity, minWeight }) =>
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
      }),
  );

  server.registerTool(
    "recall_remember",
    {
      description:
        "Append a durable event to the DevHub memory spine — a decision, a gotcha, a resolved failure, anything a future session should not have to rediscover. Cheaper and lower-ceremony than writing a learning note, and immediately retrievable via `recall`. Pass a stable `id` to make re-emitting safe.",
      inputSchema: {
        title: z.string().describe("One line. Lead with the outcome, not the preamble."),
        body: z.string().optional().describe("Detail — the failure output, the reasoning, the fix"),
        kind: z
          .enum(["decision", "session", "run", "alert", "manual", "commit", "pr", "ticket", "note"])
          .optional()
          .describe("Default `decision`"),
        source: z.string().optional().describe("Who is recording this (default `mcp`)"),
        url: z.string().optional().describe("Deep link back to the thing"),
        id: z.string().optional().describe("Stable id — re-emitting the same id is a no-op"),
      },
    },
    async ({ title, body, kind, source, url, id }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.post<{ written?: number; skipped?: number }>(
          "/api/recall/events",
          { kind: kind ?? "decision", title, body, source: source ?? "mcp", url, id },
        );
        if ((data.written ?? 0) === 0) {
          return { content: [{ type: "text", text: `Already recorded (id \`${id}\`) — nothing written.` }] };
        }
        return { content: [{ type: "text", text: `Recorded: ${title}` }] };
      }),
  );

  server.registerTool(
    "recall_index",
    {
      description:
        "Inspect or rebuild the recall index. Call with `rebuild: true` after bulk-importing notes; normal edits are picked up automatically on the next query.",
      inputSchema: {
        rebuild: z.boolean().optional().describe("Rebuild rather than just report status"),
        ingest: z
          .boolean()
          .optional()
          .describe("Pull recent git commits into the event spine before rebuilding"),
      },
    },
    async ({ rebuild, ingest }) =>
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
      }),
  );
}
