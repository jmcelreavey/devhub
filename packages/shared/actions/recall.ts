import { z } from "zod";
import { defineAction } from "./define.ts";

interface RecallContext<Input> { execute: (input: Input) => unknown }

export const recallInput = z.object({
        query: z
          .string().min(1, "query is required")
          .describe("Natural language question, ticket key, repo name, or error message"),
        budgetTokens: z
          .number().int().min(100).max(32_000)
          .optional()
          .describe("Token budget for the assembled context (default 2000). Hits are packed by score until spent."),
        limit: z.number().int().min(1).max(50).optional().describe("Max passages (default 12)"),
        kinds: z
          .array(z.enum(["note", "learning", "doc", "task", "event", "diagram"]))
          .optional()
          .describe("Restrict to these sources"),
        alpha: z
          .number().min(0).max(1)
          .optional()
          .describe("0 = pure keyword, 1 = pure vector, default 0.5. Use 0.2 for exact identifiers, 0.8 for vague recall."),
      }).meta({ additionalProperties: false });
export const recall = defineAction<typeof recallInput, RecallContext<z.output<typeof recallInput>>, unknown>({
  input: recallInput,
  http: {"reason":"The MCP recall view always requests markdown and omits the dashboard's since/format selectors."},
  mcp: { name: "recall", toolset: "recall", description: "Ranked, token-budgeted, cited context from everything DevHub knows — notes, learnings, docs, task history and the event spine (commits, PRs, runs, sessions). Use this BEFORE starting work on a topic, ticket or repo, and prefer it over `search` when the question is 'what do I already know about X' rather than 'which file contains the string X'." },
  handler: (input, context) => context.execute(input),
});

export const recallGraphInput = z.object({
        entity: z
          .string()
          .optional()
          .describe("Entity key, e.g. `jira:ABC-3774`, `repo:devhub`, `pr:owner/repo#525`"),
        minWeight: z.number().optional().describe("Drop edges below this co-occurrence count"),
      }).meta({ additionalProperties: false });
export const recallGraph = defineAction<typeof recallGraphInput, RecallContext<z.output<typeof recallGraphInput>>, unknown>({
  input: recallGraphInput,
  http: {"method":"GET","path":"/api/recall/graph"},
  mcp: { name: "recall_graph", toolset: "recall", description: "Derived entity graph — what turns up alongside a ticket, PR, repo or note across all indexed content. Unlike `entity_links_read`, which only sees hand-written ## Links sections, these edges are derived from co-occurrence and exist without anyone having typed them. Omit `entity` for the whole graph." },
  handler: (input, context) => context.execute(input),
});

export const recallEventInput = z.object({
  kind: z.enum(["commit", "pr", "ticket", "run", "session", "note", "alert", "decision", "manual"]),
  title: z.string().min(1).max(500), body: z.string().max(20_000).optional(),
  source: z.string().min(1).max(120), url: z.string().url().optional(),
  ts: z.string().datetime({ offset: true }).optional(), id: z.string().min(1).max(200).optional(),
  refs: z.array(z.object({ kind: z.enum(["task", "meeting", "pr", "note", "diagram", "calendar", "jira", "repo"]), id: z.string().min(1), label: z.string().min(1), href: z.string().optional() })).optional(),
  meta: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export const recallRememberInput = z.object({
        title: recallEventInput.shape.title.describe("One line. Lead with the outcome, not the preamble."),
        body: recallEventInput.shape.body.describe("Detail — the failure output, the reasoning, the fix"),
        kind: recallEventInput.shape.kind.optional()
          .describe("Default `decision`"),
        source: recallEventInput.shape.source.optional().describe("Who is recording this (default `mcp`)"),
        url: recallEventInput.shape.url.describe("Deep link back to the thing"),
        id: recallEventInput.shape.id.describe("Stable id — re-emitting the same id is a no-op"),
      }).meta({ additionalProperties: false });
export const recallRemember = defineAction<typeof recallRememberInput, RecallContext<z.output<typeof recallRememberInput>>, unknown>({
  input: recallRememberInput,
  http: {"method":"POST","path":"/api/recall/events", discriminator: "body has no events" },
  mcp: { name: "recall_remember", toolset: "recall", description: "Append a durable event to the DevHub memory spine — a decision, a gotcha, a resolved failure, anything a future session should not have to rediscover. Cheaper and lower-ceremony than writing a learning note. The next `recall` query rebuilds if the spine is newer than the index, so the event is retrievable without an explicit `recall_index`. Pass a stable `id` to make re-emitting safe." },
  handler: (input, context) => context.execute(input),
});

export const recallIndexInput = z.object({
        rebuild: z.boolean().optional().describe("Rebuild rather than just report status"),
        ingest: z
          .boolean()
          .optional()
          .describe("Pull recent git commits into the event spine before rebuilding"),
      }).meta({ additionalProperties: false });
export const recallIndex = defineAction<typeof recallIndexInput, RecallContext<z.output<typeof recallIndexInput>>, unknown>({
  input: recallIndexInput,
  http: {"reason":"MCP orchestration selects index status, rebuild or Git ingestion; no combined HTTP endpoint."},
  mcp: { name: "recall_index", toolset: "recall", description: "Inspect or rebuild the recall index. Call with `rebuild: true` after bulk-importing notes. Normal edits are picked up automatically: the next `recall` query rebuilds if sources are newer than the last build." },
  handler: (input, context) => context.execute(input),
});

function localRecall<Schema extends z.ZodObject>(input: Schema, method: "GET" | "POST", path: string, reason: string, discriminator?: string) {
  return defineAction<Schema, RecallContext<z.output<Schema>>, unknown>({ input, http: { method, path, discriminator }, mcp: { reason }, handler: (value, context) => context.execute(value) });
}
export const recallQueryInput = z.object({
  q: recallInput.shape.query,
  limit: z.coerce.number().pipe(recallInput.shape.limit.unwrap()).optional(),
  budget: z.coerce.number().pipe(recallInput.shape.budgetTokens.unwrap()).optional(),
  alpha: z.coerce.number().pipe(recallInput.shape.alpha.unwrap()).optional(),
  since: z.coerce.number().int().optional(),
  format: z.enum(["json", "markdown"]).optional(),
});
export const recallQuery = localRecall(recallQueryInput, "GET", "/api/recall", "The dashboard query view supports since and JSON/markdown selection. MCP recall fixes markdown and exposes its existing narrower arguments.");

export const recallEventsBodyInput = z.union([recallEventInput, z.object({ events: z.array(recallEventInput).min(1).max(500) })]);
export const recallEventsAppendInput = z.object({ events: z.array(recallEventInput).min(1).max(500) });
export const recallEventsAppend = localRecall(recallEventsAppendInput, "POST", "/api/recall/events", "HTTP batch ingestion preserves atomic append and accepts event refs/metadata; recall_remember appends one event.", "body has events");
export const recallEventsReadInput = z.object({ limit: z.number(), since: z.string().optional(), kinds: z.array(recallEventInput.shape.kind).optional() });
export const recallEventsRead = localRecall(recallEventsReadInput, "GET", "/api/recall/events", "The browser event-spine view is distinct from ranked retrieval and MCP's single-event append.");
export const recallIndexStatusInput = z.object({});
export const recallIndexStatus = localRecall(recallIndexStatusInput, "GET", "/api/recall/index", "Read by the recall_index MCP orchestration.");
export const recallIndexBuildInput = z.object({ kinds: z.array(z.enum(["note", "learning", "doc", "task", "event", "diagram"])).optional(), clear: z.boolean().optional() });
export const recallIndexBuild = localRecall(recallIndexBuildInput, "POST", "/api/recall/index", "The authenticated browser rebuild supports source selection and clearing. recall_index rebuilds with defaults only.");
export const recallIngestInput = z.object({ allRepos: z.boolean().optional(), limit: z.number().int().min(1).max(2000).optional(), since: z.string().max(40).optional(), reindex: z.boolean().optional() });
export const recallIngest = localRecall(recallIngestInput, "POST", "/api/recall/ingest", "Authenticated Git ingestion is selected with fixed allRepos/reindex settings by recall_index.");
