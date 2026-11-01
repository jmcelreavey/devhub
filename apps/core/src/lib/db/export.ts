/**
 * Turning a result set into something you can take elsewhere.
 *
 * Pure and synchronous over an already-materialised result — streaming a large
 * export is the route's job, not this module's. Three formats, chosen because
 * they cover the three reasons people export: a spreadsheet (CSV), another
 * program (JSON), and another database (SQL INSERT).
 */

import type { DbResultSet } from "./types";

export type DbExportFormat = "csv" | "json" | "sql";

export const DB_EXPORT_FORMATS: readonly DbExportFormat[] = ["csv", "json", "sql"];

export const DB_EXPORT_CONTENT_TYPES: Record<DbExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
  sql: "application/sql; charset=utf-8",
};

/**
 * Quote a CSV field.
 *
 * The leading-character check is not decoration: a cell beginning `=`, `+`, `-`
 * or `@` is executed as a formula when the file is opened in Excel or Sheets.
 * A column of user-supplied text is a plausible source of one, so the value is
 * prefixed with a tab, which those programs strip on display but do not treat
 * as a formula.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  const risky = /^[=+\-@\t\r]/.test(text);
  const body = risky ? `\t${text}` : text;
  return /["\n\r,]/.test(body) || risky ? `"${body.replace(/"/g, '""')}"` : body;
}

export function toCsv(result: DbResultSet): string {
  const header = result.columns.map((c) => csvCell(c.name)).join(",");
  const rows = result.rows.map((row) => row.map(csvCell).join(","));
  return [header, ...rows].join("\n");
}

/** Row objects rather than arrays — what anything consuming JSON expects. */
export function toJson(result: DbResultSet): string {
  const names = result.columns.map((c) => c.name);
  const objects = result.rows.map((row) =>
    Object.fromEntries(names.map((name, i) => [name, row[i] ?? null])),
  );
  return JSON.stringify(objects, null, 2);
}

/** Double-quoted identifier, safe for Postgres and SQLite. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * A SQL literal.
 *
 * String-building SQL is normally the wrong answer, and it is worth being clear
 * why it is acceptable here: this output is a *file for a human to review*, not
 * a statement this application executes. Nothing generated here is sent to a
 * database by DevHub. Values are still escaped properly so the file is valid
 * and so pasting it somewhere else is not a trap.
 */
export function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function toSqlInserts(result: DbResultSet, tableName = "exported_rows"): string {
  if (result.columns.length === 0) return "";
  const columns = result.columns.map((c) => quoteIdent(c.name)).join(", ");
  const table = quoteIdent(tableName);
  return result.rows
    .map((row) => `INSERT INTO ${table} (${columns}) VALUES (${row.map(sqlLiteral).join(", ")});`)
    .join("\n");
}

export function exportResultSet(
  result: DbResultSet,
  format: DbExportFormat,
  tableName?: string,
): string {
  if (format === "csv") return toCsv(result);
  if (format === "json") return toJson(result);
  return toSqlInserts(result, tableName);
}

/** `posts-2026-08-28.csv` — dated, because exports accumulate. */
export function exportFilename(base: string, format: DbExportFormat, now = new Date()): string {
  const safe = base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "export";
  const date = now.toISOString().slice(0, 10);
  return `${safe}-${date}.${format}`;
}
