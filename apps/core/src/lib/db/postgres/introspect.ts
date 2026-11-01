/**
 * Reading a Postgres database's shape out of `pg_catalog`.
 *
 * Catalog queries rather than shelling out to `pg_dump`: `pg_dump` has to be
 * installed, has to match the server's major version, and would be another
 * external command to time out. The catalog is already reachable over the
 * connection we have.
 *
 * Every query here runs through the pool's read-only path, so introspection
 * cannot modify anything even on a write connection.
 */

import { runStatement } from "../pool";
import { DB_METADATA_TIMEOUT_MS } from "../timeouts";
import type {
  DbColumnInfo,
  DbConstraintInfo,
  DbForeignKeyInfo,
  DbIndexInfo,
  DbNamespace,
  DbObjectDetail,
  DbObjectSummary,
} from "../introspect-types";

/** Catalogue schemas the user did not create and rarely wants to see. */
const SYSTEM_SCHEMAS = new Set(["pg_catalog", "information_schema", "pg_toast"]);

async function query(connectionId: string, sql: string, rowLimit = 5_000) {
  return runStatement(connectionId, sql, {
    readOnly: true,
    timeoutMs: DB_METADATA_TIMEOUT_MS,
    rowLimit,
  });
}

/** `"public"."my table"` — quoted so an unusual name cannot become syntax. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function qualify(namespace: string, name: string): string {
  return `${quoteIdent(namespace)}.${quoteIdent(name)}`;
}

/** Single-quote a literal for the catalog queries below. */
function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export async function listNamespaces(connectionId: string): Promise<DbNamespace[]> {
  const result = await query(
    connectionId,
    `SELECT nspname FROM pg_namespace
     WHERE nspname NOT LIKE 'pg_temp%' AND nspname NOT LIKE 'pg_toast_temp%'
     ORDER BY nspname`,
  );
  return result.rows.map((row) => ({
    name: String(row[0]),
    system: SYSTEM_SCHEMAS.has(String(row[0])),
  }));
}

export async function listObjects(
  connectionId: string,
  namespace?: string,
): Promise<DbObjectSummary[]> {
  // `reltuples` is the planner's estimate, refreshed by ANALYZE. Deliberately
  // not count(*): an exact count on a large prd table is a slow query nobody
  // asked for, and the number is only used to size the row-count column.
  const where = namespace
    ? `n.nspname = ${literal(namespace)}`
    : `n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'`;

  const result = await query(
    connectionId,
    `SELECT n.nspname,
            c.relname,
            c.relkind,
            c.reltuples::bigint,
            pg_total_relation_size(c.oid),
            obj_description(c.oid, 'pg_class')
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND ${where}
     ORDER BY n.nspname, c.relname`,
  );

  return result.rows.map((row) => ({
    namespace: String(row[0]),
    name: String(row[1]),
    kind: relkindToObjectKind(String(row[2])),
    // -1 means "never analysed", which is not the same as "empty".
    estimatedRows: Number(row[3]) >= 0 ? Number(row[3]) : undefined,
    sizeBytes: row[4] === null ? undefined : Number(row[4]),
    comment: row[5] === null ? undefined : String(row[5]),
  }));
}

function relkindToObjectKind(relkind: string): DbObjectSummary["kind"] {
  if (relkind === "v") return "view";
  if (relkind === "m") return "materialized-view";
  return "table";
}

export async function describeObject(
  connectionId: string,
  namespace: string,
  name: string,
): Promise<DbObjectDetail> {
  const [columns, indexes, foreignKeys, referencedBy, constraints, summary] = await Promise.all([
    describeColumns(connectionId, namespace, name),
    describeIndexes(connectionId, namespace, name),
    describeForeignKeys(connectionId, namespace, name),
    describeReferencedBy(connectionId, namespace, name),
    describeConstraints(connectionId, namespace, name),
    describeSummary(connectionId, namespace, name),
  ]);

  return {
    namespace,
    name,
    kind: summary?.kind ?? "table",
    columns,
    indexes,
    foreignKeys,
    referencedBy,
    constraints,
    estimatedRows: summary?.estimatedRows,
    comment: summary?.comment,
    ddl: composeDdl({ namespace, name, columns, indexes, foreignKeys, constraints }),
  };
}

async function describeSummary(
  connectionId: string,
  namespace: string,
  name: string,
): Promise<DbObjectSummary | null> {
  const objects = await listObjects(connectionId, namespace);
  return objects.find((o) => o.name === name) ?? null;
}

async function describeColumns(
  connectionId: string,
  namespace: string,
  name: string,
): Promise<DbColumnInfo[]> {
  const result = await query(
    connectionId,
    `SELECT a.attname,
            format_type(a.atttypid, a.atttypmod),
            NOT a.attnotnull,
            pg_get_expr(d.adbin, d.adrelid),
            a.attnum,
            COALESCE(pk.is_pk, false),
            col_description(a.attrelid, a.attnum)
     FROM pg_attribute a
     JOIN pg_class c ON c.oid = a.attrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     LEFT JOIN (
       SELECT conrelid, unnest(conkey) AS attnum, true AS is_pk
       FROM pg_constraint WHERE contype = 'p'
     ) pk ON pk.conrelid = a.attrelid AND pk.attnum = a.attnum
     WHERE n.nspname = ${literal(namespace)}
       AND c.relname = ${literal(name)}
       -- Negative attnum is a system column (ctid, xmin); attisdropped is a
       -- column that was removed but still occupies its slot.
       AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY a.attnum`,
  );

  return result.rows.map((row) => ({
    name: String(row[0]),
    dataType: String(row[1]),
    nullable: row[2] === true,
    defaultValue: row[3] === null ? undefined : String(row[3]),
    position: Number(row[4]),
    primaryKey: row[5] === true,
    comment: row[6] === null ? undefined : String(row[6]),
  }));
}

async function describeIndexes(
  connectionId: string,
  namespace: string,
  name: string,
): Promise<DbIndexInfo[]> {
  const result = await query(
    connectionId,
    `SELECT i.relname,
            ix.indisunique,
            ix.indisprimary,
            pg_get_indexdef(ix.indexrelid),
            ARRAY(
              SELECT pg_get_indexdef(ix.indexrelid, k + 1, true)
              FROM generate_subscripts(ix.indkey, 1) AS k
              ORDER BY k
            )
     FROM pg_index ix
     JOIN pg_class i ON i.oid = ix.indexrelid
     JOIN pg_class c ON c.oid = ix.indrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ${literal(namespace)} AND c.relname = ${literal(name)}
     ORDER BY i.relname`,
  );

  return result.rows.map((row) => ({
    name: String(row[0]),
    unique: row[1] === true,
    primary: row[2] === true,
    definition: row[3] === null ? undefined : String(row[3]),
    columns: parsePgArray(row[4]),
  }));
}

/**
 * Read an array column back out of a result set.
 *
 * Two shapes arrive here, and missing the second one silently produced empty
 * foreign-key column lists — a `FOREIGN KEY ()` in generated DDL:
 *
 * - `text[]` has a parser registered in `pg`, so it arrives as a JS array and
 *   `toCellValue` stringifies it to JSON.
 * - `name[]` (what `ARRAY(SELECT a.attname …)` produces) has none, so it
 *   arrives as the raw Postgres literal `{author_id,tenant}`.
 *
 * The queries now cast to `::text` so the first path is the normal one, but the
 * literal is still handled: a catalogue column typed `name` is easy to
 * reintroduce, and failing closed to `[]` is invisible in a way this bug proved.
 */
export function parsePgArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];

  const text = value.trim();
  if (!text) return [];

  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }

  // Postgres array literal: {a,b} — elements are quoted only when they contain
  // a comma, brace, quote or whitespace.
  if (text.startsWith("{") && text.endsWith("}")) {
    const body = text.slice(1, -1);
    if (!body) return [];
    const out: string[] = [];
    let current = "";
    let quoted = false;
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (quoted) {
        if (ch === "\\") {
          current += body[++i] ?? "";
        } else if (ch === '"') {
          quoted = false;
        } else current += ch;
        continue;
      }
      if (ch === '"') quoted = true;
      else if (ch === ",") {
        out.push(current);
        current = "";
      } else current += ch;
    }
    out.push(current);
    return out;
  }

  return [];
}

async function describeForeignKeys(
  connectionId: string,
  namespace: string,
  name: string,
): Promise<DbForeignKeyInfo[]> {
  const result = await query(
    connectionId,
    `SELECT con.conname,
            ARRAY(SELECT a.attname::text FROM unnest(con.conkey) k
                  JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k),
            fn.nspname,
            fc.relname,
            ARRAY(SELECT a.attname::text FROM unnest(con.confkey) k
                  JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k),
            con.confdeltype,
            con.confupdtype
     FROM pg_constraint con
     JOIN pg_class c ON c.oid = con.conrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_class fc ON fc.oid = con.confrelid
     JOIN pg_namespace fn ON fn.oid = fc.relnamespace
     WHERE con.contype = 'f'
       AND n.nspname = ${literal(namespace)} AND c.relname = ${literal(name)}
     ORDER BY con.conname`,
  );
  return result.rows.map(toForeignKey);
}

/** The other direction: which tables point at this one. */
async function describeReferencedBy(
  connectionId: string,
  namespace: string,
  name: string,
): Promise<DbForeignKeyInfo[]> {
  const result = await query(
    connectionId,
    `SELECT con.conname,
            ARRAY(SELECT a.attname::text FROM unnest(con.conkey) k
                  JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k),
            n.nspname,
            c.relname,
            ARRAY(SELECT a.attname::text FROM unnest(con.confkey) k
                  JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k),
            con.confdeltype,
            con.confupdtype
     FROM pg_constraint con
     JOIN pg_class c ON c.oid = con.conrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_class fc ON fc.oid = con.confrelid
     JOIN pg_namespace fn ON fn.oid = fc.relnamespace
     WHERE con.contype = 'f'
       AND fn.nspname = ${literal(namespace)} AND fc.relname = ${literal(name)}
     ORDER BY con.conname`,
  );
  return result.rows.map(toForeignKey);
}

function toForeignKey(row: unknown[]): DbForeignKeyInfo {
  return {
    name: String(row[0]),
    columns: parsePgArray(row[1]),
    referencedNamespace: String(row[2]),
    referencedTable: String(row[3]),
    referencedColumns: parsePgArray(row[4]),
    onDelete: fkAction(row[5]),
    onUpdate: fkAction(row[6]),
  };
}

/** `pg_constraint.confdeltype` is a single char; spell it out for the UI. */
function fkAction(code: unknown): string | undefined {
  const map: Record<string, string> = {
    a: "NO ACTION",
    r: "RESTRICT",
    c: "CASCADE",
    n: "SET NULL",
    d: "SET DEFAULT",
  };
  return typeof code === "string" ? map[code] : undefined;
}

async function describeConstraints(
  connectionId: string,
  namespace: string,
  name: string,
): Promise<DbConstraintInfo[]> {
  const result = await query(
    connectionId,
    `SELECT con.conname, con.contype, pg_get_constraintdef(con.oid)
     FROM pg_constraint con
     JOIN pg_class c ON c.oid = con.conrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ${literal(namespace)} AND c.relname = ${literal(name)}
       AND con.contype IN ('c', 'u', 'p', 'x')
     ORDER BY con.conname`,
  );

  const kinds: Record<string, DbConstraintInfo["kind"]> = {
    c: "check",
    u: "unique",
    p: "primary",
    x: "exclude",
  };

  return result.rows.map((row) => ({
    name: String(row[0]),
    kind: kinds[String(row[1])] ?? "check",
    definition: String(row[2]),
  }));
}

/**
 * Compose a `CREATE TABLE` from the catalog.
 *
 * Not a substitute for `pg_dump` and does not try to be — no partitioning, no
 * inheritance, no storage parameters. It is the readable summary the Structure
 * tab shows, and it is honest about being generated.
 */
export function composeDdl(input: {
  namespace: string;
  name: string;
  columns: DbColumnInfo[];
  indexes: DbIndexInfo[];
  foreignKeys: DbForeignKeyInfo[];
  constraints: DbConstraintInfo[];
}): string {
  const { namespace, name, columns, indexes, foreignKeys, constraints } = input;
  if (columns.length === 0) return "";

  const lines = columns.map((c) => {
    const parts = [quoteIdent(c.name), c.dataType];
    if (!c.nullable) parts.push("NOT NULL");
    if (c.defaultValue) parts.push(`DEFAULT ${c.defaultValue}`);
    return `  ${parts.join(" ")}`;
  });

  // Primary key and check/unique constraints go inside the CREATE; foreign keys
  // follow as ALTERs so the statement does not depend on creation order.
  for (const con of constraints) {
    if (con.kind === "primary" || con.kind === "unique" || con.kind === "check") {
      lines.push(`  CONSTRAINT ${quoteIdent(con.name)} ${con.definition}`);
    }
  }

  const create = `CREATE TABLE ${qualify(namespace, name)} (\n${lines.join(",\n")}\n);`;

  const alters = foreignKeys.map(
    (fk) =>
      `ALTER TABLE ${qualify(namespace, name)} ADD CONSTRAINT ${quoteIdent(fk.name)} ` +
      `FOREIGN KEY (${fk.columns.map(quoteIdent).join(", ")}) ` +
      `REFERENCES ${qualify(fk.referencedNamespace, fk.referencedTable)} ` +
      `(${fk.referencedColumns.map(quoteIdent).join(", ")})` +
      (fk.onDelete && fk.onDelete !== "NO ACTION" ? ` ON DELETE ${fk.onDelete}` : "") +
      (fk.onUpdate && fk.onUpdate !== "NO ACTION" ? ` ON UPDATE ${fk.onUpdate}` : "") +
      ";",
  );

  // Index definitions come from `pg_get_indexdef`, which is exact — including
  // partial and expression indexes, which no hand-composition would get right.
  const indexDefs = indexes
    .filter((ix) => !ix.primary && ix.definition)
    .map((ix) => `${ix.definition};`);

  return [create, ...alters, ...indexDefs].join("\n\n");
}
