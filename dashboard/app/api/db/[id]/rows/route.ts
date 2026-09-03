import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { parseBody, withErrorHandler } from "@/lib/api-utils";
import { applyTransaction } from "@/lib/db/pool";
import { describeObject } from "@/lib/db/introspect";
import { resolveRowIdentity } from "@/lib/db/identity";
import { buildMutationPlan, describePlan, DbMutationError } from "@/lib/db/mutate";
import { recordDbHistory } from "@/lib/db/history";
import { DB_QUERY_TIMEOUT_MS } from "@/lib/db/timeouts";
import { dbError, dbFailure, requireAuth, withConnection, type ConnectionParams } from "../../_shared";

export const dynamic = "force-dynamic";

const RowValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const RowsSchema = z.object({
  namespace: z.string().min(1),
  table: z.string().min(1),
  updates: z
    .array(
      z.object({
        rowIndex: z.number().int().nonnegative(),
        key: z.record(z.string(), RowValue),
        changes: z.record(z.string(), RowValue),
      }),
    )
    .default([]),
  deletes: z.array(z.object({ key: z.record(z.string(), RowValue) })).default([]),
  inserts: z.array(z.record(z.string(), RowValue)).default([]),
  /** Connection label, typed by the user, for a production connection. */
  confirm: z.string().optional(),
  /** Build and return the SQL without running it. */
  preview: z.boolean().optional(),
});

/**
 * Apply staged grid edits.
 *
 * Deliberately its own route rather than a shape of `/query`: the statements
 * are *built here* from a row identity the server re-derives, never taken from
 * the client. A client that could post arbitrary SQL to an "edit" endpoint
 * would make the read-only gate decorative.
 *
 * Three gates, in order — the same ones a typed statement faces:
 *  1. read-only connections are refused outright;
 *  2. production connections need the label typed;
 *  3. the table must have a real row identity, or nothing is built at all.
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: ConnectionParams) => {
  const denied = requireAuth(req);
  if (denied) return denied;

  const { id } = await params;
  const resolved = await withConnection(id);
  if (!resolved.ok) return resolved.response;
  const connection = resolved.connection;

  const parsed = await parseBody(req, RowsSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  if (connection.accessMode === "read") {
    return dbError(
      `'${connection.label}' is a read-only connection, so no changes were applied. ` +
        `Switch to a profile with write access in Ops to edit rows.`,
      403,
      "read_only",
    );
  }

  if (connection.engine === "mongodb") {
    // Mongo edits are a different shape entirely — a document, not a row — and
    // pretending otherwise would produce a worse editor than no editor.
    return dbError(
      "Editing MongoDB documents from the grid is not supported yet. Use an updateOne command on the Query tab.",
      400,
    );
  }

  try {
    // The identity is re-derived server-side. Trusting the client's idea of
    // which columns identify a row would let a crafted request widen a WHERE
    // clause, which is exactly the failure this path exists to prevent.
    const detail = await describeObject(id, body.namespace, body.table);
    const identity = resolveRowIdentity(connection.engine, detail);
    if (!identity.ok) {
      return dbError(identity.refusal.reason, 409, "no_row_identity");
    }

    const plan = buildMutationPlan({
      engine: connection.engine,
      namespace: body.namespace,
      table: body.table,
      identity: identity.identity,
      updates: body.updates,
      deletes: body.deletes,
      inserts: body.inserts,
    });

    const summary = describePlan(body);

    if (body.preview) {
      return NextResponse.json({ preview: plan.preview, summary, statements: plan.expectedRows });
    }

    if (connection.dangerous && body.confirm?.trim() !== connection.label) {
      return dbError(
        `'${connection.label}' is a production connection. To apply ${summary}, ` +
          `type the connection name exactly: ${connection.label}`,
        403,
        "confirm_required",
        { connectionLabel: connection.label },
      );
    }

    const started = Date.now();
    const result = await applyTransaction(id, plan.statements, { timeoutMs: DB_QUERY_TIMEOUT_MS });

    recordDbHistory({
      connectionId: connection.id,
      connectionLabel: connection.label,
      statement: plan.preview,
      kind: "write",
      durationMs: Date.now() - started,
      ok: true,
      rowCount: result.rowsAffected.reduce((a, b) => a + b, 0),
    });

    return NextResponse.json({
      applied: result.rowsAffected.length,
      rowsAffected: result.rowsAffected,
      summary,
    });
  } catch (err) {
    if (err instanceof DbMutationError) return dbError(err.message, 400);
    return dbFailure(err);
  }
}, "db.rows");

/**
 * A single row by identity, for refreshing one row after an edit without
 * re-running the whole query.
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: ConnectionParams) => {
  const denied = requireAuth(req);
  if (denied) return denied;

  const { id } = await params;
  const resolved = await withConnection(id);
  if (!resolved.ok) return resolved.response;

  const url = new URL(req.url);
  const namespace = url.searchParams.get("namespace");
  const table = url.searchParams.get("name");
  if (!namespace || !table) return dbError("'namespace' and 'name' are required.", 400);

  try {
    const detail = await describeObject(id, namespace, table);
    const identity = resolveRowIdentity(resolved.connection.engine, detail);
    return NextResponse.json({
      identity: identity.ok ? identity.identity : null,
      editable: identity.ok && resolved.connection.accessMode === "write",
    });
  } catch (err) {
    return dbFailure(err);
  }
}, "db.rows.get");
