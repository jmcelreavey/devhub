/**
 * Reading a SQLite database's shape.
 *
 * The easy one: SQLite stores the original `CREATE` text in `sqlite_master`, so
 * the DDL needs no composing — it is exactly what the author wrote, comments
 * and all. Everything else comes from `PRAGMA`.
 */

import { runStatement } from "../pool";
import { DB_METADATA_TIMEOUT_MS } from "../timeouts";
import type {
  DbColumnInfo,
  DbForeignKeyInfo,
  DbIndexInfo,
  DbNamespace,
  DbObjectDetail,
  DbObjectSummary,
} from "../introspect-types";

/** SQLite has one namespace per attached database; unattached, that is `main`. */
export const SQLITE_NAMESPACE = "main";

async function query(connectionId: string, sql: string, rowLimit = 5_000) {
  return runStatement(connectionId, sql, {
    readOnly: true,
    timeoutMs: DB_METADATA_TIMEOUT_MS,
    rowLimit,
  });
}

/** SQLite identifiers quote with double quotes, doubling any inside. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export async function listNamespaces(): Promise<DbNamespace[]> {
  return [{ name: SQLITE_NAMESPACE, system: false }];
}

export async function listObjects(connectionId: string): Promise<DbObjectSummary[]> {
  const result = await query(
    connectionId,
    `SELECT name, type FROM sqlite_master
     WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
     ORDER BY type, name`,
  );

  return result.rows.map((row) => ({
    namespace: SQLITE_NAMESPACE,
    name: String(row[0]),
    kind: String(row[1]) === "view" ? "view" : "table",
  }));
}

export async function describeObject(
  connectionId: string,
  name: string,
): Promise<DbObjectDetail> {
  const [columns, indexes, foreignKeys, ddl, kind] = await Promise.all([
    describeColumns(connectionId, name),
    describeIndexes(connectionId, name),
    describeForeignKeys(connectionId, name),
    readDdl(connectionId, name),
    readKind(connectionId, name),
  ]);

  return {
    namespace: SQLITE_NAMESPACE,
    name,
    kind,
    columns,
    indexes,
    foreignKeys,
    // SQLite has no catalogue of inbound references; finding them would mean
    // running `PRAGMA foreign_key_list` over every table. Cheap on a small
    // database, wasteful on a large one, and not what the Structure tab is for.
    referencedBy: [],
    // CHECK constraints live only in the CREATE text, which is shown in full.
    constraints: [],
    ddl,
  };
}

async function readKind(connectionId: string, name: string): Promise<DbObjectDetail["kind"]> {
  const result = await query(
    connectionId,
    `SELECT type FROM sqlite_master WHERE name = ${literal(name)} LIMIT 1`,
  );
  return String(result.rows[0]?.[0]) === "view" ? "view" : "table";
}

/** The original CREATE statement, exactly as written. */
async function readDdl(connectionId: string, name: string): Promise<string | undefined> {
  const result = await query(
    connectionId,
    `SELECT sql FROM sqlite_master WHERE name = ${literal(name)} AND sql IS NOT NULL`,
  );
  const statements = result.rows.map((row) => String(row[0])).filter(Boolean);
  return statements.length > 0 ? statements.join(";\n\n") + ";" : undefined;
}

async function describeColumns(connectionId: string, name: string): Promise<DbColumnInfo[]> {
  // `table_info` omits generated columns; `table_xinfo` includes them with a
  // `hidden` flag, which is what you want in a structure view.
  const result = await query(connectionId, `PRAGMA table_xinfo(${quoteIdent(name)})`);

  return result.rows.map((row) => ({
    position: Number(row[0]) + 1,
    name: String(row[1]),
    // An untyped column is legal in SQLite and shows as an empty string.
    dataType: String(row[2] || "BLOB"),
    nullable: Number(row[3]) === 0,
    defaultValue: row[4] === null ? undefined : String(row[4]),
    primaryKey: Number(row[5]) > 0,
  }));
}

async function describeIndexes(connectionId: string, name: string): Promise<DbIndexInfo[]> {
  const list = await query(connectionId, `PRAGMA index_list(${quoteIdent(name)})`);

  const indexes = await Promise.all(
    list.rows.map(async (row) => {
      const indexName = String(row[1]);
      const info = await query(connectionId, `PRAGMA index_info(${quoteIdent(indexName)})`);
      const definition = await query(
        connectionId,
        `SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ${literal(indexName)}`,
      );
      return {
        name: indexName,
        unique: Number(row[2]) === 1,
        // `origin` is 'pk' for the implicit primary-key index.
        primary: String(row[3]) === "pk",
        // A NULL column name is an expression index; keep the slot rather than
        // silently shortening the column list.
        columns: info.rows.map((c) => (c[2] === null ? "(expression)" : String(c[2]))),
        definition: definition.rows[0]?.[0] ? String(definition.rows[0][0]) : undefined,
      } satisfies DbIndexInfo;
    }),
  );

  return indexes;
}

async function describeForeignKeys(
  connectionId: string,
  name: string,
): Promise<DbForeignKeyInfo[]> {
  const result = await query(connectionId, `PRAGMA foreign_key_list(${quoteIdent(name)})`);

  // One row per column, grouped by the constraint's `id`, so a composite key
  // does not come back as several single-column constraints.
  const byId = new Map<number, DbForeignKeyInfo>();
  for (const row of result.rows) {
    const id = Number(row[0]);
    const existing = byId.get(id);
    if (existing) {
      existing.columns.push(String(row[3]));
      existing.referencedColumns.push(String(row[4]));
      continue;
    }
    byId.set(id, {
      // SQLite does not name foreign keys; synthesise something stable.
      name: `fk_${name}_${id}`,
      columns: [String(row[3])],
      referencedNamespace: SQLITE_NAMESPACE,
      referencedTable: String(row[2]),
      referencedColumns: [String(row[4])],
      onUpdate: row[5] === null ? undefined : String(row[5]),
      onDelete: row[6] === null ? undefined : String(row[6]),
    });
  }

  return [...byId.values()];
}
