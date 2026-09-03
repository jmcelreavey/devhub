/**
 * Everything the editor needs to complete a name as you type.
 *
 * Table names alone are half a feature — the moment you write `SELECT ` you
 * want columns, and the moment you write `blog.` you want that schema's tables.
 * So this fetches schemas, tables *and* every column in **one query per
 * connection** rather than describing tables one at a time: a 60-table schema
 * would otherwise be 60 round trips to make an editor feel responsive, which is
 * the wrong trade in both directions.
 */

import { runStatement } from "./pool";
import { DB_METADATA_TIMEOUT_MS } from "./timeouts";
import { findDbConnection } from "./registry";
import { DbConnectionNotFoundError } from "./provider";

export interface DbCompletionSource {
  /** Schema names, for `blog.` → tables. */
  schemas: string[];
  /**
   * Qualified table name → its columns. Keyed `schema.table`; the caller also
   * registers the bare name, since people type both.
   */
  tables: Record<string, string[]>;
  /** The schema an unqualified name resolves to, so `posts` completes as `blog.posts`. */
  defaultSchema?: string;
}

/**
 * A ceiling on how much of a schema is offered.
 *
 * A catalogue with thousands of tables would make the payload larger than the
 * page and the completion list useless. Names come back ordered, so the cut is
 * at least stable rather than arbitrary.
 */
const MAX_COLUMNS = 20_000;

async function query(connectionId: string, sql: string) {
  return runStatement(connectionId, sql, {
    readOnly: true,
    timeoutMs: DB_METADATA_TIMEOUT_MS,
    rowLimit: MAX_COLUMNS,
  });
}


/**
 * Group `(schema, table, column)` triples into the map the editor wants.
 * Pure, so the grouping is testable without a database.
 */
export function groupCompletionRows(
  rows: { schema: string; table: string; column: string }[],
): DbCompletionSource["tables"] {
  const tables: Record<string, string[]> = {};
  for (const row of rows) {
    const key = `${row.schema}.${row.table}`;
    (tables[key] ??= []).push(row.column);
  }
  return tables;
}

async function postgresCompletions(connectionId: string): Promise<DbCompletionSource> {
  const result = await query(
    connectionId,
    `SELECT n.nspname::text, c.relname::text, a.attname::text
     FROM pg_attribute a
     JOIN pg_class c ON c.oid = a.attrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r','p','v','m','f')
       AND a.attnum > 0 AND NOT a.attisdropped
       AND n.nspname NOT IN ('pg_catalog','information_schema')
       AND n.nspname NOT LIKE 'pg_toast%'
     ORDER BY n.nspname, c.relname, a.attnum`,
  );

  const rows = result.rows.map((r) => ({
    schema: String(r[0]),
    table: String(r[1]),
    column: String(r[2]),
  }));

  const schemas = [...new Set(rows.map((r) => r.schema))].sort();

  /**
   * What an unqualified name resolves to.
   *
   * `current_schema()` is the honest answer, but only if it *has* tables.
   * Pointing the resolver at an empty schema is worse than leaving it unset —
   * and it is the common shape here, where a service keeps everything in its
   * own schema while `search_path` still says `public`.
   */
  let defaultSchema: string | undefined;
  try {
    const sp = await query(connectionId, "SELECT current_schema()::text");
    const current = sp.rows[0]?.[0];
    if (typeof current === "string" && schemas.includes(current)) defaultSchema = current;
  } catch {
    // A search_path we cannot read is not worth failing completions over.
  }
  // One schema means there is no ambiguity to preserve.
  defaultSchema ??= schemas.length === 1 ? schemas[0] : undefined;

  return { schemas, tables: groupCompletionRows(rows), defaultSchema };
}

async function sqliteCompletions(connectionId: string): Promise<DbCompletionSource> {
  // `pragma_table_info` as a table-valued function gets every column in one
  // statement — one PRAGMA per table would be a round trip each.
  const result = await query(
    connectionId,
    `SELECT m.name AS tbl, p.name AS col
     FROM sqlite_master m
     JOIN pragma_table_info(m.name) p
     WHERE m.type IN ('table','view') AND m.name NOT LIKE 'sqlite_%'
     ORDER BY m.name, p.cid`,
  );

  const rows = result.rows.map((r) => ({
    schema: "main",
    table: String(r[0]),
    column: String(r[1]),
  }));

  return { schemas: ["main"], tables: groupCompletionRows(rows), defaultSchema: "main" };
}

/**
 * MongoDB has no columns to complete against.
 *
 * Fields are per-document and inferred from a sample, so offering them as
 * completions would suggest a schema the database does not enforce. Collection
 * names are real, though, and are what you actually type.
 */
async function mongoCompletions(connectionId: string, database: string): Promise<DbCompletionSource> {
  const result = await query(
    connectionId,
    JSON.stringify({ collection: "*", operation: "listCollections" }),
  );
  const nameIndex = result.columns.findIndex((c) => c.name === "name");
  const tables: Record<string, string[]> = {};
  for (const row of result.rows) {
    const name = nameIndex >= 0 ? String(row[nameIndex]) : null;
    if (name && !name.startsWith("system.")) tables[`${database}.${name}`] = [];
  }
  return { schemas: [database], tables, defaultSchema: database };
}

export async function getCompletions(connectionId: string): Promise<DbCompletionSource> {
  const connection = await findDbConnection(connectionId);
  if (!connection) throw new DbConnectionNotFoundError(connectionId);

  if (connection.engine === "postgres") return postgresCompletions(connectionId);
  if (connection.engine === "sqlite") return sqliteCompletions(connectionId);
  return mongoCompletions(connectionId, connectionId.split(":")[2] ?? "database");
}
