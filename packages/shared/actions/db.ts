import { z } from "zod";
import { defineAction, type ActionDefinition } from "./define.ts";

interface DbActionContext<Input> { run: (input: Input) => Promise<unknown> }
function dbAction<Schema extends z.ZodObject>(
  input: Schema,
  http: ActionDefinition<Schema, DbActionContext<z.output<Schema>>, unknown>["http"],
  mcp: ActionDefinition<Schema, DbActionContext<z.output<Schema>>, unknown>["mcp"],
): ActionDefinition<Schema, DbActionContext<z.output<Schema>>, unknown> {
  return defineAction({ input, http, mcp, handler: (value, context) => context.run(value) });
}

const connectionId = z.string().describe("Connection id from db_connections, e.g. team:rds:payments:dev or local:app-cache");
const format = z.enum(["compact", "json"]).optional().describe("Response format (default compact)");
export const dbConnectionsInput = z.object({
  refresh: z.boolean().optional().describe("Re-derive the list instead of using the 30s cache (e.g. after switching AWS profile)"),
  connectionId: z.string().optional().describe("Return one exact connection id"),
  env: z.string().optional().describe("Restrict to an environment such as dev, sbx, or prd"),
  engine: z.enum(["postgres", "mongodb", "sqlite"]).optional(),
  service: z.string().optional().describe("Case-insensitive match against connection id or label"),
  includeUnavailable: z.boolean().optional().describe("Include unavailable connections (default true)"),
}).meta({ additionalProperties: false });
export const dbPreflightInput = z.object({ connectionId }).meta({ additionalProperties: false });
export const dbSchemaInput = z.object({ connectionId, namespace: z.string().optional().describe("Restrict to one schema / database"), includeSystem: z.boolean().optional().describe("Include system schemas and objects (default false)"), format }).meta({ additionalProperties: false });
export const dbTableInput = z.object({ connectionId, namespace: z.string().describe("Schema (Postgres), database (Mongo), or \u0027main\u0027 (SQLite)"), name: z.string().describe("Table or collection name"), detail: z.enum(["summary", "full"]).optional().describe("Detail level (default summary)") }).meta({ additionalProperties: false });
export const dbQueryInput = z.object({ connectionId, statement: z.string().describe("The query to run"), rowLimit: z.number().int().positive().max(50_000).optional().describe("Max rows (MCP default 100)"), timeoutMs: z.number().int().positive().max(300_000).optional().describe("Query timeout in ms (default 60000)"), format }).meta({ additionalProperties: false });
export const dbExecuteInput = z.object({ connectionId, statement: z.string().describe("The statement to run"), confirm: z.boolean().describe("Must be true to execute (this modifies data)"), confirmLabel: z.string().optional().describe("Required for connections flagged dangerous (prd + write): the connection\u0027s exact label, from db_connections"), timeoutMs: z.number().int().positive().max(300_000).optional(), format }).meta({ additionalProperties: false });
export const dbCancelInput = z.object({ connectionId }).meta({ additionalProperties: false });
export const dbDiffInput = z.object({ left: z.string().describe("Connection id for the left side, e.g. team:rds:payments:dev"), right: z.string().describe("Connection id for the right side, e.g. team:rds:payments:prd"), namespace: z.string().optional().describe("Restrict to one schema"), tables: z.array(z.string()).optional().describe("Restrict the deep comparison to these tables") }).meta({ additionalProperties: false });
export const dbHistoryInput = z.object({ connectionId: z.string().optional().describe("Restrict to one connection"), q: z.string().optional().describe("Substring search over the statement text"), limit: z.number().int().positive().max(200).optional() }).meta({ additionalProperties: false });

export const dbConnections = dbAction(dbConnectionsInput, { method: "GET", path: "/api/db/connections" }, { name: "db_connections", toolset: "db", description: "List every database connection this machine can open (PostgreSQL, MongoDB, SQLite), with engine, environment, read/write access mode and availability. plugin connections are derived from your IAM access and the active AWS profile. Requires the dashboard running." });
export const dbPreflight = dbAction(dbPreflightInput, { method: "GET", path: "/api/db/[id]/preflight" }, { name: "db_preflight", toolset: "db", description: "Check whether a connection can be opened right now — AWS credentials valid, Tailscale up. Run this when a connection times out; the answer is usually a down tailnet rather than the database. Requires the dashboard running." });
export const dbSchema = dbAction(dbSchemaInput, { method: "GET", path: "/api/db/[id]/schema" }, { name: "db_schema", toolset: "db", description: "List the schemas and tables (or collections) on a connection, with estimated row counts and sizes. Requires the dashboard running." });
export const dbTable = dbAction(dbTableInput, { method: "GET", path: "/api/db/[id]/table" }, { name: "db_table", toolset: "db", description: "Describe one table or collection: columns, indexes, constraints, foreign keys in both directions, composed DDL, and whether its rows can be edited. For MongoDB the column list is inferred from a document sample, not a schema. Requires the dashboard running." });
export const dbQuery = dbAction(dbQueryInput, { method: "POST", path: "/api/db/[id]/query", discriminator: "body readOnly is truthy" }, { name: "db_query", toolset: "db", description: "Run a read-only query and return the rows. SQL for PostgreSQL/SQLite; for MongoDB either shell shorthand (db.posts.find({...})) or a JSON command document. Anything that is not a read is refused here — use db_execute. Results are row-capped; check `truncated`. Requires the dashboard running." });
export const dbExecute = dbAction(dbExecuteInput, { method: "POST", path: "/api/db/[id]/query", discriminator: "body readOnly is falsy" }, { name: "db_execute", toolset: "db", description: "Run a statement that modifies data or schema (INSERT/UPDATE/DELETE/DDL, or a Mongo write). Requires confirm:true. Refused outright on a read-only connection; first use db_connect with accessMode:\u0027write\u0027 and fix:true when plugin credentials need elevating. On a production connection with write access, `confirmLabel` must exactly match the connection\u0027s label. Requires the dashboard running." });
export const dbCancel = dbAction(dbCancelInput, { method: "POST", path: "/api/db/[id]/cancel" }, { name: "db_cancel", toolset: "db", description: "Cancel whatever a connection is currently running. Returns cancelled:false when nothing was running, or when the engine offers no way to cancel (MongoDB). Requires the dashboard running." });
export const dbDiff = dbAction(dbDiffInput, { method: "POST", path: "/api/db/diff" }, { name: "db_diff", toolset: "db", description: "Compare the schemas of two connections — the \u0027works in dev, not in prd\u0027 question. Reports tables present on one side only, and for shared tables any column added, removed, retyped, or with different nullability or defaults, plus missing indexes. Read-only. Requires the dashboard running." });
export const dbHistory = dbAction(dbHistoryInput, { method: "GET", path: "/api/db/history" }, { name: "db_history", toolset: "db", description: "Recent database queries run through DevHub, newest first — what ran, against which connection, when, and whether it succeeded. Requires the dashboard running." });

export const dbClose = dbAction(dbCancelInput, { method: "DELETE", path: "/api/db/[id]/cancel" }, { reason: "Closing a pooled connection is a database browser operation." });
export const dbConnectionsReset = dbAction(z.object({}), { method: "POST", path: "/api/db/connections" }, { reason: "Resetting pooled connections after a profile switch is a database browser operation." });
export const dbHistoryClear = dbAction(z.object({}), { method: "DELETE", path: "/api/db/history" }, { reason: "Clearing local database history is a dashboard operation." });

export const dbDiscoverInput = z.object({});
export const dbManagedConnectionsInput = z.object({});
export const dbSaveConnectionInput = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/, "slug must be a lowercase slug"),
  label: z.string().trim().min(1).max(120),
  engine: z.enum(["postgres", "mongodb", "sqlite"]),
  group: z.string().trim().max(60).optional(),
  host: z.string().trim().max(255).optional(),
  port: z.number().int().positive().max(65_535).optional(),
  database: z.string().trim().max(255).optional(),
  user: z.string().trim().max(255).optional(),
  password: z.string().max(2_000).optional(),
  ssl: z.boolean().optional(),
  uri: z.string().trim().max(4_000).optional(),
  file: z.string().trim().max(4_000).optional(),
  readOnly: z.boolean().optional(),
});
export const dbDeleteConnectionInput = z.object({ slug: z.string().min(1) });
export const dbAiInput = z.object({
  connectionId,
  mode: z.enum(["generate", "fix", "explain", "optimise"]),
  prompt: z.string().trim().max(4_000).default(""),
  statement: z.string().max(200_000).optional(),
  error: z.string().max(4_000).optional(),
  focus: z.object({ namespace: z.string(), name: z.string() }).optional(),
});
export const dbCompletionsInput = z.object({ connectionId });
export const dbExportInput = z.object({
  connectionId,
  statement: z.string().trim().min(1).max(200_000),
  format: z.enum(["csv", "json", "sql"]),
  name: z.string().trim().max(200).optional(),
  rowLimit: z.number().int().positive().max(50_000).optional(),
});
const rowValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const dbRowsInput = z.object({
  connectionId,
  namespace: z.string().min(1),
  table: z.string().min(1),
  updates: z.array(z.object({ rowIndex: z.number().int().nonnegative(), key: z.record(z.string(), rowValue), changes: z.record(z.string(), rowValue) })).default([]),
  deletes: z.array(z.object({ key: z.record(z.string(), rowValue) })).default([]),
  inserts: z.array(z.record(z.string(), rowValue)).default([]),
  confirm: z.string().optional(),
  preview: z.boolean().optional(),
});
export const dbRowIdentityInput = z.object({ connectionId, namespace: z.string().min(1), name: z.string().min(1) });

const browserOnly = { reason: "This operation is specific to the database browser and has no MCP tool." };
const connectionSettingsOnly = { reason: "Connection settings and locally stored credentials are managed in the dashboard only." };
export const dbDiscover = dbAction(dbDiscoverInput, { method: "GET", path: "/api/db/discover" }, { reason: "Local SQLite file discovery is used by the connection settings UI only." });
export const dbManagedConnections = dbAction(dbManagedConnectionsInput, { method: "GET", path: "/api/db/connections/manage" }, connectionSettingsOnly);
export const dbSaveConnection = dbAction(dbSaveConnectionInput, { method: "PUT", path: "/api/db/connections/manage" }, connectionSettingsOnly);
export const dbDeleteConnection = dbAction(dbDeleteConnectionInput, { method: "DELETE", path: "/api/db/connections/manage" }, connectionSettingsOnly);
export const dbAi = dbAction(dbAiInput, { method: "POST", path: "/api/db/[id]/ai" }, browserOnly);
export const dbCompletions = dbAction(dbCompletionsInput, { method: "GET", path: "/api/db/[id]/completions" }, browserOnly);
export const dbExport = dbAction(dbExportInput, { method: "POST", path: "/api/db/[id]/export" }, { reason: "Exports are downloadable files produced for the database browser." });
export const dbRows = dbAction(dbRowsInput, { method: "POST", path: "/api/db/[id]/rows" }, { reason: "Staged grid edits and their production confirmation belong to the database browser." });
export const dbRowIdentity = dbAction(dbRowIdentityInput, { method: "GET", path: "/api/db/[id]/rows" }, browserOnly);


export const dbConnectInput = z.object({
  connectionId,
  accessMode: z.enum(["read", "write"]).optional().describe("Access needed after connecting. Defaults to read; use write before db_execute so plugin signs into the team writer profile (for example dev-team+)."),
  fix: z.boolean().optional().describe("Apply the available fixes. These change machine state (which AWS role you hold, whether the tailnet is up), so this defaults to false and reports what it would do."),
}).meta({ additionalProperties: false });
export const dbExplainInput = z.object({ connectionId, statement: z.string().describe("The query to explain") }).meta({ additionalProperties: false });
export const dbConnect = dbAction(dbConnectInput, { reason: "Connect orchestrates preflight and machine-specific remedies; no HTTP route performs this combined operation." }, { name: "db_connect", toolset: "db", description: "Get a connection ready to use. Runs the preflight and, with fix:true, applies the fixes it can — signing in to the AWS profile the connection needs, or bringing Tailscale up — then re-checks. Use this instead of db_preflight when the goal is 'make it work', not 'tell me what is wrong'. Requires the dashboard running." });
export const dbExplain = dbAction(dbExplainInput, { reason: "Explain plans and then executes a plain EXPLAIN through the query route; no HTTP route offers the same operation." }, { name: "db_explain", toolset: "db", description: "Show the query plan for one PostgreSQL or SQLite statement without running it. MongoDB explain is not yet exposed. Requires the dashboard running." });
