import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { parseBody, withErrorHandler } from "@/lib/api-utils";
import {
  DbRefusedError,
  executeStatement,
  planExecution,
} from "@/lib/db/execute";
import { DB_MAX_ROW_LIMIT } from "@/lib/db/types";
import { DB_QUERY_MAX_TIMEOUT_MS } from "@/lib/db/timeouts";
import {
  dbError,
  dbFailure,
  requireAuth,
  withConnection,
  type ConnectionParams,
} from "../../_shared";

export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  statement: z
    .string()
    .trim()
    .min(1, "statement is required")
    .max(200_000, "statement too long"),
  rowLimit: z.number().int().positive().max(DB_MAX_ROW_LIMIT).optional(),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(DB_QUERY_MAX_TIMEOUT_MS)
    .optional(),
  /** Restrict execution to reads even when the selected connection can write. */
  readOnly: z.boolean().optional(),
  /** Connection label, typed by the user, for a write against a prd connection. */
  confirm: z.string().optional(),
  /**
   * Classify without running. The editor asks for this as you type, so Run can
   * be disabled — and explain itself — before you press it.
   */
  planOnly: z.boolean().optional(),
});

export const POST = withErrorHandler(
  async (req: NextRequest, { params }: ConnectionParams) => {
    const denied = requireAuth(req);
    if (denied) return denied;

    const { id } = await params;
    const resolved = await withConnection(id);
    if (!resolved.ok) return resolved.response;

    const parsed = await parseBody(req, QuerySchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    // Planning never touches the database, so a parse failure here is a 400 about
    // what the user typed rather than a 500 about what the driver did.
    let plan;
    try {
      plan = planExecution(resolved.connection, body.statement);
    } catch (err) {
      return dbError(err instanceof Error ? err.message : String(err), 400);
    }

    if (body.planOnly) {
      return NextResponse.json({
        kind: plan.kind,
        statements: plan.statements.map((s) => ({
          sql: s.sql,
          kind: s.kind,
          reason: s.reason,
        })),
        refusal: plan.refusal,
        needsConfirmation: plan.needsConfirmation,
        connection: {
          id: resolved.connection.id,
          label: resolved.connection.label,
          engine: resolved.connection.engine,
        },
      });
    }

    try {
      const result = await executeStatement({
        connectionId: id,
        statement: body.statement,
        rowLimit: body.rowLimit,
        timeoutMs: body.timeoutMs,
        requiredKind: body.readOnly ? "read" : undefined,
        confirm: body.confirm,
      });
      return NextResponse.json(result);
    } catch (err) {
      if (err instanceof DbRefusedError) {
        // 403, not 400: the request is well-formed and the server understood it.
        // What is missing is permission, or a confirmation the user has not given.
        return dbError(err.message, 403, err.code, {
          connectionLabel: resolved.connection.label,
        });
      }
      return dbFailure(err);
    }
  },
  "db.query",
);
