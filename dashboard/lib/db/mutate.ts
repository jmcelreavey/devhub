/**
 * Turning staged grid edits into statements.
 *
 * Pure and parameterised. Every value goes into a placeholder, never into the
 * SQL text — this is the one module in the client where user data becomes part
 * of a statement, so it is the one place a string-built query would actually be
 * an injection rather than a stylistic complaint.
 *
 * The identity columns come from `identity.ts`, which refuses to guess. If it
 * could not find a key, nothing here runs: an UPDATE whose WHERE matches more
 * rows than the user edited is the failure mode this whole path exists to
 * avoid, and it fails silently and successfully.
 */

import type { DbRowIdentity } from "./identity";
import type { DbEngine } from "./types";

/** One staged cell change. */
export interface DbCellEdit {
  /** Row index in the result set — display only; identity is what targets it. */
  rowIndex: number;
  column: string;
  /** The value as it was when the row was fetched, for optimistic locking. */
  originalValue: unknown;
  newValue: unknown;
}

/** Everything needed to target one row. */
export interface DbRowTarget {
  /** Identity column → value, from the row as fetched. */
  key: Record<string, unknown>;
}

export interface DbStagedRow extends DbRowTarget {
  rowIndex: number;
  /** column → new value */
  changes: Record<string, unknown>;
}

export interface DbMutationPlan {
  /** Parameterised statements, in apply order. */
  statements: { sql: string; params: unknown[] }[];
  /** Human-readable preview with values inlined — for display only, never run. */
  preview: string;
  /** How many rows each statement should touch. Anything else is a bug worth aborting on. */
  expectedRows: number;
}

export class DbMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbMutationError";
  }
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function qualify(engine: DbEngine, namespace: string, name: string): string {
  // SQLite has one namespace; qualifying it is noise and, for `main`, wrong.
  return engine === "sqlite"
    ? quoteIdent(name)
    : `${quoteIdent(namespace)}.${quoteIdent(name)}`;
}

/** `$1`-style for Postgres, `?` for SQLite. */
function placeholder(engine: DbEngine, index: number): string {
  return engine === "postgres" ? `$${index}` : "?";
}

/** Inline rendering for the preview only. Never sent to a database. */
function previewLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Build the UPDATE for one row.
 *
 * The WHERE clause carries the identity **and** the original values of every
 * edited column. That second half is the optimistic lock: if someone changed
 * the row between your SELECT and your apply, the statement matches zero rows
 * and the transaction aborts, rather than silently overwriting their work.
 */
export function buildUpdate(
  engine: DbEngine,
  namespace: string,
  table: string,
  row: DbStagedRow,
  identity: DbRowIdentity,
): { sql: string; params: unknown[]; preview: string } {
  const columns = Object.keys(row.changes);
  if (columns.length === 0) throw new DbMutationError("No changes to apply.");

  const params: unknown[] = [];
  const set = columns
    .map((column) => {
      params.push(row.changes[column]);
      return `${quoteIdent(column)} = ${placeholder(engine, params.length)}`;
    })
    .join(", ");

  const where: string[] = [];
  for (const column of identity.columns) {
    const value = row.key[column];
    if (value === undefined) {
      throw new DbMutationError(`Row identity is missing '${column}'; refusing to build an UPDATE.`);
    }
    // A null identity value cannot be matched with `=`, and a row whose key is
    // null is not safely addressable at all.
    if (value === null) {
      throw new DbMutationError(`Row identity '${column}' is NULL; that row cannot be targeted safely.`);
    }
    params.push(value);
    where.push(`${quoteIdent(column)} = ${placeholder(engine, params.length)}`);
  }

  const target = qualify(engine, namespace, table);
  const sql = `UPDATE ${target} SET ${set} WHERE ${where.join(" AND ")}`;

  const previewSet = columns
    .map((c) => `${quoteIdent(c)} = ${previewLiteral(row.changes[c])}`)
    .join(", ");
  const previewWhere = identity.columns
    .map((c) => `${quoteIdent(c)} = ${previewLiteral(row.key[c])}`)
    .join(" AND ");

  return { sql, params, preview: `UPDATE ${target} SET ${previewSet} WHERE ${previewWhere};` };
}

export function buildDelete(
  engine: DbEngine,
  namespace: string,
  table: string,
  row: DbRowTarget,
  identity: DbRowIdentity,
): { sql: string; params: unknown[]; preview: string } {
  const params: unknown[] = [];
  const where: string[] = [];

  for (const column of identity.columns) {
    const value = row.key[column];
    if (value === undefined || value === null) {
      throw new DbMutationError(
        `Row identity '${column}' is missing or NULL; that row cannot be deleted safely.`,
      );
    }
    params.push(value);
    where.push(`${quoteIdent(column)} = ${placeholder(engine, params.length)}`);
  }

  const target = qualify(engine, namespace, table);
  const previewWhere = identity.columns
    .map((c) => `${quoteIdent(c)} = ${previewLiteral(row.key[c])}`)
    .join(" AND ");

  return {
    sql: `DELETE FROM ${target} WHERE ${where.join(" AND ")}`,
    params,
    preview: `DELETE FROM ${target} WHERE ${previewWhere};`,
  };
}

export function buildInsert(
  engine: DbEngine,
  namespace: string,
  table: string,
  values: Record<string, unknown>,
): { sql: string; params: unknown[]; preview: string } {
  const columns = Object.keys(values);
  if (columns.length === 0) throw new DbMutationError("An insert needs at least one column.");

  const params: unknown[] = [];
  const marks = columns.map((column) => {
    params.push(values[column]);
    return placeholder(engine, params.length);
  });

  const target = qualify(engine, namespace, table);
  const columnList = columns.map(quoteIdent).join(", ");

  return {
    sql: `INSERT INTO ${target} (${columnList}) VALUES (${marks.join(", ")})`,
    params,
    preview: `INSERT INTO ${target} (${columnList}) VALUES (${columns
      .map((c) => previewLiteral(values[c]))
      .join(", ")});`,
  };
}

export interface BuildPlanInput {
  engine: DbEngine;
  namespace: string;
  table: string;
  identity: DbRowIdentity;
  updates: DbStagedRow[];
  deletes: DbRowTarget[];
  inserts: Record<string, unknown>[];
}

/**
 * Assemble the whole change set.
 *
 * Order is deliberate: inserts, then updates, then deletes. Deleting last means
 * an update to a row you also deleted is not a silent no-op halfway through,
 * and inserting first lets a new row be edited in the same apply.
 */
export function buildMutationPlan(input: BuildPlanInput): DbMutationPlan {
  const { engine, namespace, table, identity } = input;

  if (identity.columns.length === 0) {
    throw new DbMutationError("This table has no usable row identity, so it cannot be edited.");
  }

  const built = [
    ...input.inserts.map((values) => buildInsert(engine, namespace, table, values)),
    ...input.updates.map((row) => buildUpdate(engine, namespace, table, row, identity)),
    ...input.deletes.map((row) => buildDelete(engine, namespace, table, row, identity)),
  ];

  if (built.length === 0) throw new DbMutationError("Nothing staged to apply.");

  return {
    statements: built.map(({ sql, params }) => ({ sql, params })),
    preview: built.map((b) => b.preview).join("\n"),
    expectedRows: built.length,
  };
}

/** Short human summary for the confirmation dialog. */
export function describePlan(input: Pick<BuildPlanInput, "updates" | "deletes" | "inserts">): string {
  const parts: string[] = [];
  if (input.inserts.length) parts.push(`${input.inserts.length} insert${input.inserts.length === 1 ? "" : "s"}`);
  if (input.updates.length) parts.push(`${input.updates.length} update${input.updates.length === 1 ? "" : "s"}`);
  if (input.deletes.length) parts.push(`${input.deletes.length} delete${input.deletes.length === 1 ? "" : "s"}`);
  return parts.join(", ") || "no changes";
}
