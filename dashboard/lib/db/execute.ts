/**
 * Running a statement, with the rules applied.
 *
 * The single place where "may this run?" is decided, so the UI and the MCP
 * tools cannot disagree about it. Both call `executeStatement`; neither reaches
 * the pool directly.
 *
 * Three gates, in order:
 *
 * 1. **Classification** — what does this statement do? Cheap, and produces the
 *    error message the user actually reads.
 * 2. **Access mode** — a read connection refuses anything that is not a read.
 *    Enforced again by the engine (`BEGIN READ ONLY`, a Mongo allowlist,
 *    `readOnly: true`), which is what makes it a guarantee rather than a check.
 * 3. **Danger** — a write against a connection marked dangerous (prd with a
 *    privileged profile) needs the user to type the connection's label. Same
 *    shape as the `confirmDangerous` gate on the AWS profile switch, and for
 *    the same reason: the cost of being wrong is not recoverable.
 */

import { findDbConnection } from "./registry";
import { DbConnectionNotFoundError } from "./provider";
import { runStatement } from "./pool";
import { clampQueryTimeout } from "./timeouts";
import { classifySqlBatch, type DbStatement, type DbStatementKind } from "./statement-kind";
import { classifyMongoCommand, parseMongoCommand } from "./mongo/command";
import { recordDbHistory } from "./history";
import {
  DB_DEFAULT_ROW_LIMIT,
  DB_MAX_ROW_LIMIT,
  type DbConnectionRef,
  type DbResultSet,
} from "./types";

export type DbRefusalCode = "read_only" | "confirm_required";

export class DbRefusedError extends Error {
  constructor(
    readonly code: DbRefusalCode,
    message: string,
    /** The statement that caused the refusal, when the batch had several. */
    readonly statement?: string,
  ) {
    super(message);
    this.name = "DbRefusedError";
  }
}

export interface ExecuteOptions {
  connectionId: string;
  statement: string;
  rowLimit?: number;
  timeoutMs?: number;
  /**
   * The connection's label, typed by the user, for a write against a dangerous
   * connection. Not a boolean: a checkbox is clicked by reflex, and typing
   * "CAPI · prd" requires having read which connection this is.
   */
  confirm?: string;
}

export interface ExecuteResult {
  connectionId: string;
  kind: DbStatementKind;
  /** One per statement in the batch, in order. */
  results: DbResultSet[];
  /** How each statement was classified, for the UI's per-statement badges. */
  statements: { sql: string; kind: DbStatementKind; reason?: string }[];
  durationMs: number;
}

/** Plan a batch without running it — what the UI needs to render Run vs a refusal. */
export interface ExecutePlan {
  kind: DbStatementKind;
  statements: { sql: string; kind: DbStatementKind; reason?: string }[];
  /** Set when this batch would be refused; the UI disables Run and shows it. */
  refusal?: { code: DbRefusalCode; message: string };
  /** True when running needs the user to type the connection label first. */
  needsConfirmation: boolean;
}

function clampRowLimit(requested: number | undefined): number {
  if (!requested || !Number.isFinite(requested) || requested <= 0) return DB_DEFAULT_ROW_LIMIT;
  return Math.min(Math.floor(requested), DB_MAX_ROW_LIMIT);
}

/**
 * Split and classify, per engine.
 *
 * SQL is a batch of statements; a Mongo command is always exactly one, because
 * the shorthand has no separator and inventing one would be a language.
 */
export function planStatements(
  connection: DbConnectionRef,
  statement: string,
): { kind: DbStatementKind; statements: DbStatement[] } {
  if (connection.engine === "mongodb") {
    const command = parseMongoCommand(statement);
    const { kind, reason } = classifyMongoCommand(command);
    return {
      kind,
      statements: [{ sql: statement.trim(), kind, reason, start: 0, end: statement.length }],
    };
  }

  const batch = classifySqlBatch(statement);
  return { kind: batch.kind, statements: batch.statements };
}

/** Decide whether a batch may run, without running it. */
export function planExecution(connection: DbConnectionRef, statement: string): ExecutePlan {
  const { kind, statements } = planStatements(connection, statement);
  const offender = statements.find((s) => s.kind !== "read");

  if (kind !== "read" && connection.accessMode === "read") {
    return {
      kind,
      statements,
      needsConfirmation: false,
      refusal: {
        code: "read_only",
        message: readOnlyMessage(connection, offender),
      },
    };
  }

  return { kind, statements, needsConfirmation: kind !== "read" && connection.dangerous };
}

function readOnlyMessage(connection: DbConnectionRef, offender?: DbStatement): string {
  const detail = offender?.reason ? ` ${offender.reason}` : "";
  const what = offender ? ` (${firstWords(offender.sql)})` : "";
  return (
    `'${connection.label}' is a read-only connection, so this ${offender?.kind ?? "statement"}${what} was not run.${detail} ` +
    `Switch to a profile with write access in Ops to change that.`
  );
}

function firstWords(sql: string, count = 6): string {
  const words = sql.trim().split(/\s+/).slice(0, count).join(" ");
  return words.length < sql.trim().length ? `${words}…` : words;
}

export async function executeStatement(opts: ExecuteOptions): Promise<ExecuteResult> {
  const connection = await findDbConnection(opts.connectionId);
  if (!connection) throw new DbConnectionNotFoundError(opts.connectionId);

  const plan = planExecution(connection, opts.statement);

  if (plan.refusal) {
    throw new DbRefusedError(plan.refusal.code, plan.refusal.message);
  }

  if (plan.needsConfirmation && opts.confirm?.trim() !== connection.label) {
    throw new DbRefusedError(
      "confirm_required",
      `'${connection.label}' is a production connection with write access. ` +
        `To run a ${plan.kind} against it, type the connection name exactly: ${connection.label}`,
    );
  }

  const rowLimit = clampRowLimit(opts.rowLimit);
  const timeoutMs = clampQueryTimeout(opts.timeoutMs);
  const started = Date.now();
  const results: DbResultSet[] = [];

  try {
    for (const statement of plan.statements) {
      results.push(
        await runStatement(opts.connectionId, statement.sql, {
          rowLimit,
          timeoutMs,
          // Read statements run in a read-only transaction even on a write
          // connection: a SELECT has no business being able to write, and the
          // narrower mode is free.
          readOnly: connection.accessMode === "read" || statement.kind === "read",
        }),
      );
    }
  } catch (err) {
    recordDbHistory({
      connectionId: connection.id,
      connectionLabel: connection.label,
      statement: opts.statement,
      kind: plan.kind,
      durationMs: Date.now() - started,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  const durationMs = Date.now() - started;
  recordDbHistory({
    connectionId: connection.id,
    connectionLabel: connection.label,
    statement: opts.statement,
    kind: plan.kind,
    durationMs,
    ok: true,
    rowCount: results.reduce((total, r) => total + r.rows.length, 0),
  });

  return {
    connectionId: connection.id,
    kind: plan.kind,
    results,
    statements: plan.statements.map((s) => ({ sql: s.sql, kind: s.kind, reason: s.reason })),
    durationMs,
  };
}
