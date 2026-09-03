import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { parseBody, withErrorHandler } from "@/lib/api-utils";
import { isAiConfigured } from "@/lib/ai/preference";
import { AiSqlRefusedError, generateSql, selectRelevantTables } from "@/lib/db/ai-sql";
import { describeObject, listObjects } from "@/lib/db/introspect";
import { dbError, dbFailure, requireAuth, withConnection, type ConnectionParams } from "../../_shared";

export const dynamic = "force-dynamic";

const AiSchema = z.object({
  mode: z.enum(["generate", "fix", "explain", "optimise"]),
  prompt: z.string().trim().max(4_000).default(""),
  statement: z.string().max(200_000).optional(),
  error: z.string().max(4_000).optional(),
  /** Table the user is looking at — sent to the model in full. */
  focus: z.object({ namespace: z.string(), name: z.string() }).optional(),
});

/**
 * Ask a model for a query, or for a fix to one that failed.
 *
 * Nothing is executed here. The result goes back to the editor for the user to
 * read and run, so a generated statement is classified and gated exactly like
 * one they typed.
 *
 * The schema is assembled server-side rather than sent by the client: the
 * client only has what it happens to have rendered, and the useful context is
 * the focused table's real columns.
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: ConnectionParams) => {
  const denied = requireAuth(req);
  if (denied) return denied;

  if (!isAiConfigured()) {
    return dbError(
      "No AI provider is configured. Set one under Setup → AI Provider, or set AI_API_KEY.",
      503,
    );
  }

  const { id } = await params;
  const resolved = await withConnection(id);
  if (!resolved.ok) return resolved.response;

  const parsed = await parseBody(req, AiSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  if (body.mode === "generate" && !body.prompt.trim()) {
    return dbError("Describe what you want the query to do.", 400);
  }
  if ((body.mode === "fix" || body.mode === "explain" || body.mode === "optimise") && !body.statement?.trim()) {
    return dbError("There is no query to work on.", 400);
  }

  try {
    // Names for every table, plus real columns for the one in focus. Sending
    // every column of every table would blow the context on a large schema and
    // crowd out the one that matters.
    const objects = await listObjects(id, body.focus?.namespace);
    const tables = selectRelevantTables(objects, body.focus);

    if (body.focus) {
      try {
        const detail = await describeObject(id, body.focus.namespace, body.focus.name);
        const target = tables.find(
          (t) => t.name === body.focus?.name && t.namespace === body.focus?.namespace,
        );
        if (target) {
          target.columns = detail.columns.map((c) => ({
            name: c.name,
            dataType: c.dataType,
            nullable: c.nullable,
            primaryKey: c.primaryKey,
          }));
        }
      } catch {
        // Columns are an enrichment; the table list alone is still useful.
      }
    }

    const result = await generateSql({
      connection: resolved.connection,
      prompt: body.prompt,
      statement: body.statement,
      error: body.error,
      tables,
      mode: body.mode,
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AiSqlRefusedError) {
      // 422: the request was fine and the model answered — the answer was not
      // allowed to run on this connection.
      return dbError(err.message, 422, "read_only");
    }
    return dbFailure(err);
  }
}, "db.ai");
