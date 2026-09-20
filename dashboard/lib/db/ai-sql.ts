/**
 * Asking a model for SQL, and asking it to fix SQL that failed.
 *
 * The value here is almost entirely in the context, not the prompt. A model
 * asked "get me published posts by author" with no schema writes plausible SQL
 * against imagined tables; the same model given the real table and column names
 * writes something you can run. So this assembles the schema and spends its
 * effort there.
 *
 * Two hard rules, both enforced after generation rather than merely requested:
 *
 * 1. **Nothing is executed.** The result lands in the editor for the user to
 *    read and run. A model that writes a `DELETE` produces a `DELETE` in the
 *    buffer, classified and gated like anything else they typed.
 * 2. **A read-only connection gets read-only SQL.** Asked on a read connection,
 *    the output is re-classified and rejected if it is not a read — the model is
 *    told, but a prompt is a request, not a constraint.
 */

import { generateAiText } from "@/lib/ai/generate";
import { classifySqlBatch } from "./statement-kind";
import type { DbColumnInfo, DbObjectSummary } from "./introspect-types";
import type { DbConnectionRef, DbEngine } from "./types";

export interface AiSqlSchemaTable {
  namespace: string;
  name: string;
  columns?: Pick<DbColumnInfo, "name" | "dataType" | "nullable" | "primaryKey">[];
}

export interface AiSqlRequest {
  connection: DbConnectionRef;
  /** What the user asked for, in their words. */
  prompt: string;
  /** Tables to describe to the model. */
  tables: AiSqlSchemaTable[];
  /** Existing statement, for a fix or a rewrite. */
  statement?: string;
  /** The engine's error, when fixing. */
  error?: string;
  mode: "generate" | "fix" | "explain" | "optimise";
}

export interface AiSqlResult {
  /** SQL (or a Mongo command) ready to drop into the editor. */
  sql: string;
  /** One or two sentences on what it does — shown above the editor, not inserted. */
  note?: string;
  provider: string;
}

const ENGINE_GUIDANCE: Record<DbEngine, string> = {
  postgres:
    "PostgreSQL. Use standard Postgres syntax, double-quoted identifiers when they need quoting, and $1-style parameters only if the user asked for a prepared statement.",
  sqlite:
    "SQLite. Note the limited ALTER TABLE support and dynamic typing. There is a single namespace, so do not schema-qualify.",
  mongodb:
    "MongoDB. Do NOT write SQL. Reply with a mongosh-style command such as db.collection.find({ … }).limit(50), or a JSON command document with `collection` and `operation` keys.",
};

/** Trimmed hard: a 400-table schema would swamp the request and the useful part. */
const MAX_TABLES = 60;
const MAX_COLUMNS_PER_TABLE = 40;

/**
 * Render the schema compactly.
 *
 * `table(col type, col type)` rather than JSON or DDL: it is the densest form a
 * model reads reliably, which matters when the budget is the difference between
 * including the table the user meant and not.
 */
export function renderSchemaForPrompt(tables: AiSqlSchemaTable[]): string {
  return tables
    .slice(0, MAX_TABLES)
    .map((table) => {
      const qualified = table.namespace && table.namespace !== "main"
        ? `${table.namespace}.${table.name}`
        : table.name;
      if (!table.columns?.length) return `- ${qualified}`;
      const columns = table.columns
        .slice(0, MAX_COLUMNS_PER_TABLE)
        .map((c) => `${c.name} ${c.dataType}${c.primaryKey ? " PK" : ""}${c.nullable ? "" : " NOT NULL"}`)
        .join(", ");
      return `- ${qualified}(${columns})`;
    })
    .join("\n");
}

function systemPrompt(connection: DbConnectionRef, mode: AiSqlRequest["mode"]): string {
  const lines = [
    `You write queries for ${ENGINE_GUIDANCE[connection.engine]}`,
    "",
    "Rules:",
    "- Reply with ONLY the query. No prose, no explanation, no markdown fences.",
    "- If a short caveat is essential, put it on a single trailing SQL comment line.",
    "- Use only the tables and columns given. Never invent a name.",
    "- Always bound the result: add a LIMIT (or .limit()) unless the user asked for an aggregate.",
  ];

  if (connection.accessMode === "read") {
    lines.push(
      "- This connection is READ-ONLY. Write a SELECT (or a read command). Never INSERT, UPDATE, DELETE, DROP, ALTER or CREATE.",
    );
  }
  if (connection.dangerous) {
    lines.push(
      "- This is a PRODUCTION database. Prefer narrow, indexed filters. Never write an unbounded scan or an unfiltered mutation.",
    );
  }

  if (mode === "fix") {
    lines.push("", "The user's query failed. Return a corrected version of it, not a new one.");
  }
  if (mode === "optimise") {
    lines.push("", "Return a faster query with identical results. Preserve the shape of the output.");
  }
  if (mode === "explain") {
    lines.push(
      "",
      "Instead of a query, explain in plain English what the given statement does. Two or three sentences. No SQL.",
    );
  }

  return lines.join("\n");
}

function userPrompt(request: AiSqlRequest): string {
  const parts: string[] = [];
  const schema = renderSchemaForPrompt(request.tables);
  if (schema) parts.push(`Schema:\n${schema}`);
  if (request.statement?.trim()) parts.push(`Current query:\n${request.statement.trim()}`);
  if (request.error?.trim()) parts.push(`It failed with:\n${request.error.trim()}`);
  if (request.prompt.trim()) parts.push(`Request:\n${request.prompt.trim()}`);
  return parts.join("\n\n");
}

/**
 * Strip the wrapping a model adds even when told not to.
 *
 * Asking for "only the query" works most of the time; this handles the rest
 * rather than putting a markdown fence into the editor.
 */
export function extractSql(raw: string): string {
  const text = raw.trim();
  const fenced = /^```(?:sql|json|javascript|js)?\s*\n([\s\S]*?)\n?```$/i.exec(text);
  if (fenced) return fenced[1].trim();
  // A fence somewhere in the middle, after a preamble it was asked not to write.
  const inner = /```(?:sql|json|javascript|js)?\s*\n([\s\S]*?)\n?```/i.exec(text);
  if (inner) return inner[1].trim();
  return text;
}

export class AiSqlRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiSqlRefusedError";
  }
}

export async function generateSql(request: AiSqlRequest): Promise<AiSqlResult> {
  const result = await generateAiText({
    activity: { action: "Generate SQL" },
    system: systemPrompt(request.connection, request.mode),
    prompt: userPrompt(request),
    maxOutputTokens: 900,
  });

  if (request.mode === "explain") {
    return { sql: "", note: result.text.trim(), provider: result.provider };
  }

  const sql = extractSql(result.text);
  if (!sql) throw new Error("The model returned nothing usable.");

  // The prompt asked for a read; this checks. A model instructed not to write
  // still sometimes writes, and the editor is not the place to find that out.
  if (request.connection.accessMode === "read" && request.connection.engine !== "mongodb") {
    const batch = classifySqlBatch(sql);
    if (batch.kind !== "read") {
      throw new AiSqlRefusedError(
        `The model produced a ${batch.kind} statement for a read-only connection, so it was discarded. ` +
          `Rephrase the request, or switch to a profile with write access.`,
      );
    }
  }

  return { sql, provider: result.provider };
}

/** Tables worth sending, biggest-signal first, given a table the user is looking at. */
export function selectRelevantTables(
  objects: DbObjectSummary[],
  focus?: { namespace: string; name: string } | null,
): AiSqlSchemaTable[] {
  const tables = objects.map((o) => ({ namespace: o.namespace, name: o.name }));
  if (!focus) return tables;
  // The focused table first: when the list is trimmed, that is the one that
  // must survive.
  return [
    ...tables.filter((t) => t.name === focus.name && t.namespace === focus.namespace),
    ...tables.filter((t) => !(t.name === focus.name && t.namespace === focus.namespace)),
  ];
}
