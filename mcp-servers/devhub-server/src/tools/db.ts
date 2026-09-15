import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import { withDashboardErrors } from "../dashboard-client.ts";
import { explainMissingFeature } from "../discover-dashboard.ts";

/**
 * Database client tools.
 *
 * These reach parity with the `/db` UI, writes included: whatever the
 * connection's access mode allows, these allow. That access mode is not theirs
 * to choose — it comes from the AWS profile for BI connections and from the
 * saved connection for local ones, and the dashboard enforces it again at the
 * engine (`BEGIN READ ONLY`, a Mongo command allowlist, a read-only SQLite
 * handle). An agent cannot talk its way past it.
 *
 * `confirm: true` on the mutating tools is the same convention every mutating
 * DevHub tool uses (`repos_git_commit`, `repos_git_discard`) and is the MCP
 * mirror of the dialog the UI shows — not an extra restriction. Read tools have
 * no `confirm` field at all, so the schema itself says which is which.
 *
 * The one thing an agent genuinely cannot do alone: a write against a
 * connection marked dangerous (prd with a privileged profile) needs the
 * connection's label echoed back, which means having read which connection it
 * is. The dashboard rejects it otherwise.
 *
 * Nothing here opens a database. Every tool proxies `/api/db/*` so the
 * dashboard process stays the only owner of pools and credentials — the same
 * rule the git tools follow.
 */
/**
 * Force a statement into a plain `EXPLAIN`, never `EXPLAIN ANALYZE`.
 *
 * `db_explain` promises a plan "without running it", and ANALYZE runs the
 * statement for real — so `EXPLAIN ANALYZE DELETE FROM posts` handed to an
 * *explain* tool would delete rows. Prefixing only when no EXPLAIN was present
 * is not enough: an ANALYZE the caller supplied would pass straight through.
 * Any existing EXPLAIN prefix (with its options) is stripped and replaced.
 */
export function toPlainExplain(statement: string): string {
  const stripped = statement
    .trim()
    // `EXPLAIN`, `EXPLAIN ANALYZE`, `EXPLAIN (ANALYZE, BUFFERS)`, `EXPLAIN VERBOSE`…
    .replace(/^\s*explain\s*(\([^)]*\))?\s*(analyze|analyse|verbose)?\s*/i, "")
    .trim();
  return `EXPLAIN ${stripped}`;
}

/** Keep the production confirmation token unambiguous even when the label itself contains separators. */
export function formatConnectionLine(
  connection: Record<string, unknown>,
): string {
  const dangerousWrite =
    connection.dangerous && connection.accessMode === "write";
  const bits = [
    String(connection.id),
    String(connection.label),
    String(connection.engine),
    `${connection.accessMode}${connection.dangerous ? " ⚠ prd" : ""}`,
    connection.open ? "open" : null,
    connection.unavailable
      ? `unavailable: ${String(connection.unavailable)}`
      : null,
    dangerousWrite
      ? `confirmLabel: ${JSON.stringify(String(connection.label))}`
      : null,
  ].filter(Boolean);
  return `- ${bits.join(" · ")}`;
}

interface DbResultPayload {
  connectionId?: string;
  kind?: string;
  durationMs?: number;
  results?: Array<{
    columns?: Array<{ name?: string }>;
    rows?: unknown[][];
    rowsAffected?: number;
    truncated?: boolean;
    durationMs?: number;
  }>;
}

interface DbSchemaPayload {
  engine?: string;
  namespaces?: Array<{ name?: string; system?: boolean }>;
  objects?: Array<{
    namespace?: string;
    name?: string;
    kind?: string;
    estimatedRows?: number;
    sizeBytes?: number;
    comment?: string;
  }>;
}

interface DbTablePayload {
  namespace?: string;
  name?: string;
  kind?: string;
  editable?: boolean;
  columns?: Array<{
    name?: string;
    dataType?: string;
    nullable?: boolean;
    defaultValue?: string;
    primaryKey?: boolean;
  }>;
  indexes?: Array<{
    name?: string;
    unique?: boolean;
    primary?: boolean;
    columns?: string[];
  }>;
  foreignKeys?: Array<{
    columns?: string[];
    referencedNamespace?: string;
    referencedTable?: string;
    referencedColumns?: string[];
  }>;
  referencedBy?: unknown[];
}

function compactValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "";
  const rendered = typeof value === "string" ? value : JSON.stringify(value);
  return rendered.replace(/\s+/g, " ").trim();
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

export function formatExecutionResult(data: DbResultPayload): string {
  const results = data.results ?? [];
  const heading = `${data.kind === "read" ? "Read" : "Executed"}${data.connectionId ? ` on ${data.connectionId}` : ""}${typeof data.durationMs === "number" ? ` in ${data.durationMs}ms` : ""}.`;
  if (results.length === 0) return heading;

  const blocks = results.map((result, index) => {
    const columns = (result.columns ?? []).map(
      (column) => column.name ?? "column",
    );
    const rows = result.rows ?? [];
    const duration =
      typeof result.durationMs === "number" ? ` in ${result.durationMs}ms` : "";
    if (columns.length === 0) {
      const count = result.rowsAffected ?? 0;
      return `Statement ${index + 1}: ${plural(count, "row")} affected${duration}.`;
    }

    return [
      `Result ${index + 1}: ${plural(rows.length, "row")}${result.truncated ? " (truncated)" : ""}${duration}.`,
      columns.join("\t"),
      ...rows.map((row) => row.map(compactValue).join("\t")),
    ].join("\n");
  });
  return [heading, ...blocks].join("\n");
}

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit++;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

export function formatSchema(
  data: DbSchemaPayload,
  includeSystem = false,
): string {
  const systemNamespaces = new Set(
    (data.namespaces ?? [])
      .filter((namespace) => namespace.system)
      .map((namespace) => namespace.name),
  );
  const objects = (data.objects ?? []).filter(
    (object) => includeSystem || !systemNamespaces.has(object.namespace),
  );
  const lines = objects.map((object) => {
    const bits = [
      `${object.namespace ?? "default"}.${object.name ?? "unknown"}`,
      object.kind,
      typeof object.estimatedRows === "number"
        ? `~${object.estimatedRows.toLocaleString()} rows`
        : null,
      typeof object.sizeBytes === "number"
        ? humanBytes(object.sizeBytes)
        : null,
      object.comment,
    ].filter(Boolean);
    return `- ${bits.join(" · ")}`;
  });
  return [
    `${data.engine ?? "Database"} objects (${objects.length}):`,
    ...lines,
  ].join("\n");
}

export function formatTable(data: DbTablePayload): string {
  const columns = data.columns ?? [];
  const lines = [
    `${data.namespace ?? "default"}.${data.name ?? "unknown"} · ${data.kind ?? "object"}${data.editable === false ? " · read-only" : ""}`,
    `Columns (${columns.length}):`,
    ...columns.map((column) => {
      const bits = [
        column.name,
        column.dataType,
        column.nullable === false ? "required" : "nullable",
        column.primaryKey ? "primary key" : null,
        column.defaultValue ? `default ${column.defaultValue}` : null,
      ].filter(Boolean);
      return `- ${bits.join(" · ")}`;
    }),
  ];

  const indexes = data.indexes ?? [];
  if (indexes.length) {
    lines.push(
      `Indexes (${indexes.length}):`,
      ...indexes.map(
        (index) =>
          `- ${index.name ?? "unnamed"}${index.primary ? " · primary" : index.unique ? " · unique" : ""} · (${(index.columns ?? []).join(", ")})`,
      ),
    );
  }

  const foreignKeys = data.foreignKeys ?? [];
  if (foreignKeys.length) {
    lines.push(
      `Foreign keys (${foreignKeys.length}):`,
      ...foreignKeys.map(
        (key) =>
          `- ${(key.columns ?? []).join(", ")} → ${key.referencedNamespace ?? "default"}.${key.referencedTable ?? "unknown"} (${(key.referencedColumns ?? []).join(", ")})`,
      ),
    );
  }

  if (data.referencedBy?.length)
    lines.push(
      `Referenced by: ${plural(data.referencedBy.length, "foreign key")}.`,
    );
  return lines.join("\n");
}

export function registerDbTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;

  /**
   * Turn "404 Not Found" into "you are talking to the wrong DevHub".
   *
   * The most likely reason a `db_*` tool 404s is not a bug — it is the packaged
   * app answering on 1337 with a route table that predates these routes. A bare
   * 404 sends the user hunting for a fault that isn't there.
   */
  const withDbErrors = (fn: Parameters<typeof withDashboardErrors>[0]) =>
    withDashboardErrors(async () => {
      const result = await fn();
      if (!result.isError) return result;
      const hint = explainMissingFeature(ctx.dashboardInfo, "db");
      if (!hint) return result;
      // Widget resources have no .text; only the text entries carry the message.
      const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
      if (!/\b404\b|Not Found/i.test(text)) return result;
      return {
        content: [{ type: "text" as const, text: `${hint}\n\n(${text})` }],
        isError: true,
      };
    });

  const connectionId = z
    .string()
    .describe(
      "Connection id from db_connections, e.g. bi:rds:capi:dev or local:app-cache",
    );

  const dbPath = (id: string, sub = "") =>
    `/api/db/${encodeURIComponent(id)}${sub}`;

  const jsonText = (data: unknown, fallback = "OK"): string => {
    if (typeof data === "string") return data || fallback;
    return JSON.stringify(data, null, 2);
  };

  server.registerTool(
    "db_connections",
    {
      description:
        "List every database connection this machine can open (PostgreSQL, MongoDB, SQLite), with engine, environment, read/write access mode and availability. BI connections are derived from your IAM access and the active AWS profile. Requires the dashboard running.",
      inputSchema: {
        refresh: z
          .boolean()
          .optional()
          .describe(
            "Re-derive the list instead of using the 30s cache (e.g. after switching AWS profile)",
          ),
        connectionId: z
          .string()
          .optional()
          .describe("Return one exact connection id"),
        env: z
          .string()
          .optional()
          .describe("Restrict to an environment such as dev, sbx, or prd"),
        engine: z.enum(["postgres", "mongodb", "sqlite"]).optional(),
        service: z
          .string()
          .optional()
          .describe("Case-insensitive match against connection id or label"),
        includeUnavailable: z
          .boolean()
          .optional()
          .describe("Include unavailable connections (default true)"),
      },
    },
    async ({
      refresh,
      connectionId: requestedId,
      env,
      engine,
      service,
      includeUnavailable,
    }) =>
      withDbErrors(async () => {
        const data = await dashboard.get<{
          connections: Array<Record<string, unknown>>;
          errors: Array<{ providerId: string; message: string }>;
        }>("/api/db/connections", { refresh: refresh ? "true" : undefined });

        const serviceNeedle = service?.toLowerCase();
        const connections = data.connections.filter((connection) => {
          if (requestedId && connection.id !== requestedId) return false;
          if (env && connection.env !== env) return false;
          if (engine && connection.engine !== engine) return false;
          if (includeUnavailable === false && connection.unavailable)
            return false;
          if (
            serviceNeedle &&
            !String(connection.id).toLowerCase().includes(serviceNeedle) &&
            !String(connection.label).toLowerCase().includes(serviceNeedle)
          ) {
            return false;
          }
          return true;
        });

        if (connections.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No database connections matched the requested filters.",
              },
            ],
          };
        }

        const lines = connections.map(formatConnectionLine);

        const problems = data.errors.map(
          (e) => `! ${e.providerId}: ${e.message}`,
        );
        return {
          content: [
            {
              type: "text",
              text: [
                `Connections (${connections.length}):`,
                ...lines,
                ...problems,
              ].join("\n"),
            },
          ],
        };
      }),
  );

  server.registerTool(
    "db_preflight",
    {
      description:
        "Check whether a connection can be opened right now — AWS credentials valid, Tailscale up. Run this when a connection times out; the answer is usually a down tailnet rather than the database. Requires the dashboard running.",
      inputSchema: { connectionId },
    },
    async ({ connectionId: id }) =>
      withDbErrors(async () => {
        const data = await dashboard.get<{
          ok: boolean;
          checks: Array<{ label: string; status: string; detail?: string }>;
        }>(dbPath(id, "/preflight"));
        const lines = data.checks.map(
          (c) => `- ${c.label}: ${c.status}${c.detail ? ` — ${c.detail}` : ""}`,
        );
        return {
          content: [
            {
              type: "text",
              text: [data.ok ? "Ready." : "Not ready.", ...lines].join("\n"),
            },
          ],
        };
      }),
  );

  server.registerTool(
    "db_connect",
    {
      description:
        "Get a connection ready to use. Runs the preflight and, with fix:true, applies the fixes it can — signing in to the AWS profile the connection needs, or bringing Tailscale up — then re-checks. Use this instead of db_preflight when the goal is 'make it work', not 'tell me what is wrong'. Requires the dashboard running.",
      inputSchema: {
        connectionId,
        accessMode: z
          .enum(["read", "write"])
          .optional()
          .describe(
            "Access needed after connecting. Defaults to read; use write before db_execute so BI signs into the team writer profile (for example dev-dad+).",
          ),
        fix: z
          .boolean()
          .optional()
          .describe(
            "Apply the available fixes. These change machine state (which AWS role you hold, whether the tailnet is up), so this defaults to false and reports what it would do.",
          ),
      },
    },
    async ({ connectionId: id, accessMode, fix }) =>
      withDbErrors(async () => {
        type Check = {
          label: string;
          status: string;
          detail?: string;
          remedy?: {
            id: string;
            label: string;
            endpoint: string;
            body?: Record<string, unknown>;
          };
        };

        const preflightQuery = { accessMode: accessMode ?? "read" };
        const before = await dashboard.get<{ ok: boolean; checks: Check[] }>(
          dbPath(id, "/preflight"),
          preflightQuery,
        );
        if (before.ok) {
          return {
            content: [{ type: "text", text: "Ready — nothing to fix." }],
          };
        }

        const blockers = before.checks.filter((c) => c.status === "fail");
        const fixable = blockers.filter((c) => c.remedy);
        const describe = (c: Check) => `- ${c.label}: ${c.detail ?? "failed"}`;

        if (!fix) {
          // A dry run, matching every other mutating tool here: say exactly what
          // would happen before doing something that changes the machine.
          const lines = [
            "Not ready:",
            ...blockers.map(describe),
            "",
            fixable.length
              ? `Fixable: ${fixable.map((c) => c.remedy!.label).join(", ")}. Re-run with fix:true.`
              : "Nothing here can be fixed automatically.",
          ];
          return { content: [{ type: "text", text: lines.join("\n") }] };
        }

        if (fixable.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: [
                  "Not ready, and nothing is auto-fixable:",
                  ...blockers.map(describe),
                ].join("\n"),
              },
            ],
            isError: true,
          };
        }

        const applied: string[] = [];
        const failed: string[] = [];
        for (const check of fixable) {
          const remedy = check.remedy!;
          try {
            // Generous: signing in to Okta and bringing a tailnet up are both
            // slow, and timing out halfway through is worse than waiting.
            await dashboard.post(remedy.endpoint, remedy.body ?? {}, 300_000);
            applied.push(remedy.label);
          } catch (err) {
            failed.push(
              `${remedy.label} — ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        const after = await dashboard.get<{ ok: boolean; checks: Check[] }>(
          dbPath(id, "/preflight"),
          preflightQuery,
        );
        const lines = [
          applied.length ? `Applied: ${applied.join(", ")}.` : null,
          failed.length ? `Failed: ${failed.join("; ")}.` : null,
          "",
          after.ok
            ? "Ready — the connection can be opened now."
            : [
                "Still not ready:",
                ...after.checks
                  .filter((c) => c.status === "fail")
                  .map(describe),
              ].join("\n"),
        ].filter(Boolean);

        return {
          content: [{ type: "text", text: lines.join("\n") }],
          isError: !after.ok,
        };
      }),
  );

  server.registerTool(
    "db_schema",
    {
      description:
        "List the schemas and tables (or collections) on a connection, with estimated row counts and sizes. Requires the dashboard running.",
      inputSchema: {
        connectionId,
        namespace: z
          .string()
          .optional()
          .describe("Restrict to one schema / database"),
        includeSystem: z
          .boolean()
          .optional()
          .describe("Include system schemas and objects (default false)"),
        format: z
          .enum(["compact", "json"])
          .optional()
          .describe("Response format (default compact)"),
      },
    },
    async ({ connectionId: id, namespace, includeSystem, format }) =>
      withDbErrors(async () => {
        const data = await dashboard.get<DbSchemaPayload>(
          dbPath(id, "/schema"),
          { namespace },
          60_000,
        );
        return {
          content: [
            {
              type: "text",
              text:
                format === "json"
                  ? jsonText(data)
                  : formatSchema(data, includeSystem),
            },
          ],
        };
      }),
  );

  server.registerTool(
    "db_table",
    {
      description:
        "Describe one table or collection: columns, indexes, constraints, foreign keys in both directions, composed DDL, and whether its rows can be edited. For MongoDB the column list is inferred from a document sample, not a schema. Requires the dashboard running.",
      inputSchema: {
        connectionId,
        namespace: z
          .string()
          .describe("Schema (Postgres), database (Mongo), or 'main' (SQLite)"),
        name: z.string().describe("Table or collection name"),
        detail: z
          .enum(["summary", "full"])
          .optional()
          .describe("Detail level (default summary)"),
      },
    },
    async ({ connectionId: id, namespace, name, detail }) =>
      withDbErrors(async () => {
        const data = await dashboard.get<DbTablePayload>(
          dbPath(id, "/table"),
          { namespace, name },
          60_000,
        );
        return {
          content: [
            {
              type: "text",
              text: detail === "full" ? jsonText(data) : formatTable(data),
            },
          ],
        };
      }),
  );

  server.registerTool(
    "db_query",
    {
      description:
        "Run a read-only query and return the rows. SQL for PostgreSQL/SQLite; for MongoDB either shell shorthand (db.posts.find({...})) or a JSON command document. Anything that is not a read is refused here — use db_execute. Results are row-capped; check `truncated`. Requires the dashboard running.",
      inputSchema: {
        connectionId,
        statement: z.string().describe("The query to run"),
        rowLimit: z
          .number()
          .int()
          .positive()
          .max(50_000)
          .optional()
          .describe("Max rows (MCP default 100)"),
        timeoutMs: z
          .number()
          .int()
          .positive()
          .max(300_000)
          .optional()
          .describe("Query timeout in ms (default 60000)"),
        format: z
          .enum(["compact", "json"])
          .optional()
          .describe("Response format (default compact)"),
      },
    },
    async ({ connectionId: id, statement, rowLimit, timeoutMs, format }) =>
      withDbErrors(async () => {
        const data = await dashboard.post<DbResultPayload>(
          dbPath(id, "/query"),
          { statement, rowLimit: rowLimit ?? 100, timeoutMs, readOnly: true },
          (timeoutMs ?? 60_000) + 10_000,
        );
        return {
          content: [
            {
              type: "text",
              text:
                format === "json"
                  ? jsonText(data)
                  : formatExecutionResult(data),
            },
          ],
        };
      }),
  );

  server.registerTool(
    "db_explain",
    {
      description:
        "Show the query plan for one PostgreSQL or SQLite statement without running it. MongoDB explain is not yet exposed. Requires the dashboard running.",
      inputSchema: {
        connectionId,
        statement: z.string().describe("The query to explain"),
      },
    },
    async ({ connectionId: id, statement }) =>
      withDbErrors(async () => {
        // Prefixing EXPLAIN protects only the first statement in a batch. Plan
        // first and require exactly one, otherwise `SELECT 1; DELETE ...` would
        // explain the SELECT and execute the DELETE under a read-only tool.
        const plan = await dashboard.post<{
          statements: Array<{ sql: string }>;
          connection: { engine: string };
        }>(dbPath(id, "/query"), { statement, planOnly: true });
        if (plan.statements.length !== 1) {
          return {
            content: [
              {
                type: "text",
                text: "db_explain accepts exactly one statement.",
              },
            ],
            isError: true,
          };
        }
        if (plan.connection.engine === "mongodb") {
          return {
            content: [
              { type: "text", text: "MongoDB explain is not exposed yet." },
            ],
            isError: true,
          };
        }
        const data = await dashboard.post<unknown>(dbPath(id, "/query"), {
          statement: toPlainExplain(plan.statements[0].sql),
        });
        return { content: [{ type: "text", text: jsonText(data) }] };
      }),
  );

  server.registerTool(
    "db_execute",
    {
      description:
        "Run a statement that modifies data or schema (INSERT/UPDATE/DELETE/DDL, or a Mongo write). Requires confirm:true. Refused outright on a read-only connection; first use db_connect with accessMode:'write' and fix:true when BI credentials need elevating. On a production connection with write access, `confirmLabel` must exactly match the connection's label. Requires the dashboard running.",
      inputSchema: {
        connectionId,
        statement: z.string().describe("The statement to run"),
        confirm: z
          .boolean()
          .describe("Must be true to execute (this modifies data)"),
        confirmLabel: z
          .string()
          .optional()
          .describe(
            "Required for connections flagged dangerous (prd + write): the connection's exact label, from db_connections",
          ),
        timeoutMs: z.number().int().positive().max(300_000).optional(),
        format: z
          .enum(["compact", "json"])
          .optional()
          .describe("Response format (default compact)"),
      },
    },
    async ({
      connectionId: id,
      statement,
      confirm,
      confirmLabel,
      timeoutMs,
      format,
    }) =>
      withDbErrors(async () => {
        if (!confirm) {
          // The dry run is a real plan from the server, not a guess — so it
          // reports the same classification and refusal the real run would.
          const plan = await dashboard.post<{
            kind: string;
            statements: Array<{ sql: string; kind: string; reason?: string }>;
            refusal?: { code: string; message: string };
            needsConfirmation: boolean;
            connection: { label: string };
          }>(dbPath(id, "/query"), { statement, planOnly: true });

          const lines = plan.statements.map(
            (s) => `  [${s.kind}] ${s.sql}${s.reason ? ` — ${s.reason}` : ""}`,
          );
          const notes = [
            plan.refusal ? `REFUSED: ${plan.refusal.message}` : null,
            plan.refusal?.code === "read_only"
              ? `Connect with write credentials first: db_connect({ connectionId: ${JSON.stringify(id)}, accessMode: "write", fix: true }).`
              : null,
            plan.needsConfirmation
              ? `This connection is production. Pass confirmLabel: ${JSON.stringify(plan.connection.label)}.`
              : null,
          ].filter(Boolean);

          return {
            content: [
              {
                type: "text",
                text: [
                  `Dry run — would execute a ${plan.kind} against ${plan.connection.label}:`,
                  ...lines,
                  ...notes,
                  "Pass confirm:true to run it.",
                ].join("\n"),
              },
            ],
          };
        }

        const data = await dashboard.post<DbResultPayload>(
          dbPath(id, "/query"),
          { statement, timeoutMs, confirm: confirmLabel },
          (timeoutMs ?? 60_000) + 10_000,
        );
        return {
          content: [
            {
              type: "text",
              text:
                format === "json"
                  ? jsonText(data, "Statement executed.")
                  : formatExecutionResult(data),
            },
          ],
        };
      }),
  );

  server.registerTool(
    "db_cancel",
    {
      description:
        "Cancel whatever a connection is currently running. Returns cancelled:false when nothing was running, or when the engine offers no way to cancel (MongoDB). Requires the dashboard running.",
      inputSchema: { connectionId },
    },
    async ({ connectionId: id }) =>
      withDbErrors(async () => {
        const data = await dashboard.post<{ cancelled: boolean }>(
          dbPath(id, "/cancel"),
          {},
        );
        return {
          content: [
            {
              type: "text",
              text: data.cancelled
                ? "Cancelled the running query."
                : "Nothing was running, or this engine cannot cancel.",
            },
          ],
        };
      }),
  );

  server.registerTool(
    "db_diff",
    {
      description:
        "Compare the schemas of two connections — the 'works in dev, not in prd' question. Reports tables present on one side only, and for shared tables any column added, removed, retyped, or with different nullability or defaults, plus missing indexes. Read-only. Requires the dashboard running.",
      inputSchema: {
        left: z
          .string()
          .describe("Connection id for the left side, e.g. bi:rds:capi:dev"),
        right: z
          .string()
          .describe("Connection id for the right side, e.g. bi:rds:capi:prd"),
        namespace: z.string().optional().describe("Restrict to one schema"),
        tables: z
          .array(z.string())
          .optional()
          .describe("Restrict the deep comparison to these tables"),
      },
    },
    async ({ left, right, namespace, tables }) =>
      withDbErrors(async () => {
        const data = await dashboard.post<{
          summary: string;
          truncated: number;
          left: { label: string };
          right: { label: string };
        }>("/api/db/diff", { left, right, namespace, tables }, 180_000);

        const note = data.truncated
          ? `\n\n(${data.truncated} further shared table(s) were not compared in depth.)`
          : "";
        return {
          content: [
            {
              type: "text",
              text: `${data.left.label} vs ${data.right.label}\n\n${data.summary}${note}`,
            },
          ],
        };
      }),
  );

  server.registerTool(
    "db_history",
    {
      description:
        "Recent database queries run through DevHub, newest first — what ran, against which connection, when, and whether it succeeded. Requires the dashboard running.",
      inputSchema: {
        connectionId: z
          .string()
          .optional()
          .describe("Restrict to one connection"),
        q: z
          .string()
          .optional()
          .describe("Substring search over the statement text"),
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async ({ connectionId: id, q, limit }) =>
      withDbErrors(async () => {
        const data = await dashboard.get<{
          entries: Array<{
            at: number;
            connectionLabel: string;
            kind: string;
            statement: string;
            ok: boolean;
            durationMs: number;
            rowCount?: number;
            error?: string;
          }>;
        }>("/api/db/history", { connectionId: id, q, limit });

        if (data.entries.length === 0) {
          return { content: [{ type: "text", text: "No query history yet." }] };
        }

        const lines = data.entries.map((e) => {
          const when = new Date(e.at).toISOString();
          const outcome = e.ok
            ? `${e.rowCount ?? 0} rows in ${e.durationMs}ms`
            : `failed: ${e.error ?? "unknown"}`;
          return `- ${when} · ${e.connectionLabel} · [${e.kind}] ${e.statement} — ${outcome}`;
        });
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }),
  );
}
