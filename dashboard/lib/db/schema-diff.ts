/**
 * What is different between two databases?
 *
 * The question a single-connection client cannot answer, and the one that comes
 * up every time something works in dev and not in prd. Pure over two already-
 * fetched schemas, so it is testable without a database and reusable for any
 * pair — dev vs prd is the common case, but nothing here assumes it.
 *
 * Deliberately structural, not exhaustive. It compares what people actually get
 * caught by — a missing table, a missing or retyped column, a nullability
 * change, a missing index — and does not attempt storage parameters, collations
 * or trigger bodies. A diff nobody reads because it is 400 lines of noise is
 * worse than one that answers the question asked.
 */

import type { DbColumnInfo, DbObjectDetail, DbObjectSummary } from "./introspect-types";

export type DiffSide = "left" | "right";

export interface ObjectDiff {
  namespace: string;
  name: string;
  /** Present on one side only. */
  missingFrom?: DiffSide;
}

export interface ColumnDiff {
  column: string;
  kind: "missing" | "type" | "nullable" | "default";
  missingFrom?: DiffSide;
  left?: string;
  right?: string;
}

export interface IndexDiff {
  name: string;
  missingFrom: DiffSide;
  columns: string[];
  unique: boolean;
}

export interface TableDiff {
  namespace: string;
  name: string;
  columns: ColumnDiff[];
  indexes: IndexDiff[];
}

export interface SchemaDiff {
  /** Tables present on one side only. */
  objects: ObjectDiff[];
  /** Tables on both sides whose shape differs. */
  tables: TableDiff[];
  /** Tables compared and found identical — the reassuring half of the answer. */
  identical: number;
}

const keyOf = (o: { namespace: string; name: string }) => `${o.namespace}.${o.name}`;

/**
 * Compare the object lists.
 *
 * Namespaces are compared by *name*, which is right for dev-vs-prd of the same
 * service and wrong if someone renamed a schema between environments. The
 * alternative — matching by shape — guesses, and a diff that guesses is worse
 * than one that reports an obvious rename as an add plus a drop.
 */
export function diffObjects(left: DbObjectSummary[], right: DbObjectSummary[]): ObjectDiff[] {
  const leftKeys = new Set(left.map(keyOf));
  const rightKeys = new Set(right.map(keyOf));
  const out: ObjectDiff[] = [];

  for (const object of left) {
    if (!rightKeys.has(keyOf(object))) {
      out.push({ namespace: object.namespace, name: object.name, missingFrom: "right" });
    }
  }
  for (const object of right) {
    if (!leftKeys.has(keyOf(object))) {
      out.push({ namespace: object.namespace, name: object.name, missingFrom: "left" });
    }
  }

  return out.sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
}

/** Normalised so `int4` vs `integer` and `character varying(20)` vs `varchar(20)` do not read as differences. */
export function normaliseType(dataType: string): string {
  const t = dataType.trim().toLowerCase().replace(/\s+/g, " ");
  const aliases: Record<string, string> = {
    integer: "int4",
    int: "int4",
    bigint: "int8",
    smallint: "int2",
    "double precision": "float8",
    real: "float4",
    boolean: "bool",
    "character varying": "varchar",
    character: "bpchar",
    "timestamp without time zone": "timestamp",
    "timestamp with time zone": "timestamptz",
  };
  // Preserve a length/precision suffix while normalising the base name.
  const match = /^([a-z ]+?)(\(.*\))?$/.exec(t);
  if (!match) return t;
  const base = aliases[match[1].trim()] ?? match[1].trim();
  return `${base}${match[2] ?? ""}`;
}

export function diffColumns(left: DbColumnInfo[], right: DbColumnInfo[]): ColumnDiff[] {
  const leftByName = new Map(left.map((c) => [c.name, c]));
  const rightByName = new Map(right.map((c) => [c.name, c]));
  const out: ColumnDiff[] = [];

  for (const column of left) {
    const other = rightByName.get(column.name);
    if (!other) {
      out.push({ column: column.name, kind: "missing", missingFrom: "right" });
      continue;
    }
    if (normaliseType(column.dataType) !== normaliseType(other.dataType)) {
      out.push({
        column: column.name,
        kind: "type",
        left: column.dataType,
        right: other.dataType,
      });
    }
    if (column.nullable !== other.nullable) {
      out.push({
        column: column.name,
        kind: "nullable",
        left: column.nullable ? "nullable" : "not null",
        right: other.nullable ? "nullable" : "not null",
      });
    }
    if ((column.defaultValue ?? null) !== (other.defaultValue ?? null)) {
      out.push({
        column: column.name,
        kind: "default",
        left: column.defaultValue ?? "none",
        right: other.defaultValue ?? "none",
      });
    }
  }

  for (const column of right) {
    if (!leftByName.has(column.name)) {
      out.push({ column: column.name, kind: "missing", missingFrom: "left" });
    }
  }

  return out;
}

/**
 * Compare indexes by the columns they cover, not by name.
 *
 * Index names diverge between environments for reasons nobody cares about —
 * a manual `CREATE INDEX` here, a migration-generated name there. What matters
 * is whether the same columns are covered, so that is the key.
 */
export function diffIndexes(
  left: DbObjectDetail["indexes"],
  right: DbObjectDetail["indexes"],
): IndexDiff[] {
  const signature = (index: DbObjectDetail["indexes"][number]) =>
    `${index.unique ? "u" : "i"}:${[...index.columns].sort().join(",")}`;

  const leftSigs = new Map(left.map((i) => [signature(i), i]));
  const rightSigs = new Map(right.map((i) => [signature(i), i]));
  const out: IndexDiff[] = [];

  for (const [sig, index] of leftSigs) {
    if (!rightSigs.has(sig)) {
      out.push({ name: index.name, missingFrom: "right", columns: index.columns, unique: index.unique });
    }
  }
  for (const [sig, index] of rightSigs) {
    if (!leftSigs.has(sig)) {
      out.push({ name: index.name, missingFrom: "left", columns: index.columns, unique: index.unique });
    }
  }

  return out;
}

export function diffTable(left: DbObjectDetail, right: DbObjectDetail): TableDiff | null {
  const columns = diffColumns(left.columns, right.columns);
  const indexes = diffIndexes(left.indexes, right.indexes);
  if (columns.length === 0 && indexes.length === 0) return null;
  return { namespace: left.namespace, name: left.name, columns, indexes };
}

/** One line per difference, for a copyable summary. */
export function formatDiff(diff: SchemaDiff, leftLabel: string, rightLabel: string): string {
  const lines: string[] = [];

  for (const object of diff.objects) {
    const where = object.missingFrom === "right" ? rightLabel : leftLabel;
    lines.push(`table ${object.namespace}.${object.name} — missing from ${where}`);
  }

  for (const table of diff.tables) {
    for (const column of table.columns) {
      const ref = `${table.namespace}.${table.name}.${column.column}`;
      if (column.kind === "missing") {
        lines.push(`column ${ref} — missing from ${column.missingFrom === "right" ? rightLabel : leftLabel}`);
      } else {
        lines.push(`column ${ref} ${column.kind} — ${leftLabel}: ${column.left}, ${rightLabel}: ${column.right}`);
      }
    }
    for (const index of table.indexes) {
      lines.push(
        `index ${table.namespace}.${table.name} (${index.columns.join(", ")}) — missing from ${
          index.missingFrom === "right" ? rightLabel : leftLabel
        }`,
      );
    }
  }

  if (lines.length === 0) {
    return `No structural differences across ${diff.identical} compared table(s).`;
  }
  return lines.join("\n");
}
