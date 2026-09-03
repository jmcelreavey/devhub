import { type NextRequest } from "next/server";
import { z } from "zod";
import { parseBody, withErrorHandler } from "@/lib/api-utils";
import { DbRefusedError, executeStatement } from "@/lib/db/execute";
import {
  DB_EXPORT_CONTENT_TYPES,
  DB_EXPORT_FORMATS,
  exportFilename,
  exportResultSet,
  type DbExportFormat,
} from "@/lib/db/export";
import { DB_MAX_ROW_LIMIT } from "@/lib/db/types";
import { DB_STREAM_TIMEOUT_MS } from "@/lib/db/timeouts";
import { dbError, dbFailure, requireAuth, withConnection, type ConnectionParams } from "../../_shared";

export const dynamic = "force-dynamic";

const ExportSchema = z.object({
  statement: z.string().trim().min(1).max(200_000),
  format: z.enum(DB_EXPORT_FORMATS as unknown as [DbExportFormat, ...DbExportFormat[]]),
  /** Used for the filename and the INSERT target in SQL exports. */
  name: z.string().trim().max(200).optional(),
  rowLimit: z.number().int().positive().max(DB_MAX_ROW_LIMIT).optional(),
});

/**
 * Run a statement and return it as a file.
 *
 * Reads only. An export is a read by definition, and letting this path run a
 * write would mean a second place where the danger gate has to be right.
 *
 * Materialised rather than streamed: the row ceiling already bounds the result,
 * and a streamed export would need its own cancellation story for a file the
 * user can simply re-request.
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: ConnectionParams) => {
  const denied = requireAuth(req);
  if (denied) return denied;

  const { id } = await params;
  const resolved = await withConnection(id);
  if (!resolved.ok) return resolved.response;

  const parsed = await parseBody(req, ExportSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  try {
    const result = await executeStatement({
      connectionId: id,
      statement: body.statement,
      rowLimit: body.rowLimit ?? DB_MAX_ROW_LIMIT,
      timeoutMs: DB_STREAM_TIMEOUT_MS,
    });

    // A batch produces several result sets; a file is one table. Export the
    // last one, which is what the grid was showing.
    const last = result.results.at(-1);
    if (!last) return dbError("The statement returned no result set to export.", 400);

    const name = body.name ?? "export";
    const filename = exportFilename(name, body.format);

    return new Response(exportResultSet(last, body.format, name), {
      headers: {
        "Content-Type": DB_EXPORT_CONTENT_TYPES[body.format],
        "Content-Disposition": `attachment; filename="${filename}"`,
        // An export of prd data has no business in a shared cache.
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof DbRefusedError) {
      return dbError(err.message, 403, err.code);
    }
    return dbFailure(err);
  }
}, "db.export");
