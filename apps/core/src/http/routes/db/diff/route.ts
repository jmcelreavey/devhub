import { z } from "zod";
import { parseBody, withErrorHandler } from "../../../../lib/api-utils";
import { describeObject, listObjects } from "../../../../lib/db/introspect";
import { diffObjects, diffTable, formatDiff, type SchemaDiff } from "../../../../lib/db/schema-diff";
import { findDbConnection } from "../../../../lib/db/registry";
import { dbError, dbFailure, requireAuth } from "../_shared";
import { httpAction } from "../../../../lib/actions/http";
import { dbDiff, dbDiffInput } from "../../../../../../../packages/shared/actions/db";


const DiffSchema = dbDiffInput.extend({
  left: z.string().min(1),
  right: z.string().min(1),
});

/**
 * A ceiling on how many tables get a full column-level comparison.
 *
 * Describing a table is several catalogue queries, so a 300-table schema would
 * be ~1200 round trips against two databases. The object-level diff always
 * covers everything; this only bounds the deep pass.
 */
const MAX_DEEP_TABLES = 40;

/**
 * Compare two connections' schemas.
 *
 * The thing a single-connection client structurally cannot do, and the question
 * behind most "works in dev, not in prd" afternoons.
 *
 * Both sides must be readable, and this only ever reads — the connections are
 * opened through the same pool and the same read-only path as any query.
 */
export const POST = withErrorHandler(async (req: Request) => {
  const denied = requireAuth(req);
  if (denied) return denied;

  const parsed = await parseBody(req, DiffSchema);
  if (!parsed.ok) return parsed.response;
  const { left, right, namespace, tables } = parsed.data;

  return httpAction(dbDiff, {
    input: () => parsed.data,
    context: () => ({ run: async () => {
      if (left === right) return dbError("Pick two different connections to compare.", 400);

      const [leftRef, rightRef] = await Promise.all([findDbConnection(left), findDbConnection(right)]);
      if (!leftRef) return dbError(`No database connection with id '${left}'.`, 404, "not_found");
      if (!rightRef) return dbError(`No database connection with id '${right}'.`, 404, "not_found");

      if (leftRef.engine !== rightRef.engine) {
        return dbError(
          `Cannot compare a ${leftRef.engine} schema with a ${rightRef.engine} one — the shapes are not comparable.`,
          400,
        );
      }
      for (const ref of [leftRef, rightRef]) {
        if (ref.unavailable) return dbError(`${ref.label}: ${ref.unavailable}`, 409, "unavailable");
      }

      try {
        // Sequential, not parallel: with plugin connections both sides may need the
        // same AWS profile, and hammering two environments at once is how you
        // discover a rate limit.
        const leftObjects = await listObjects(left, namespace);
        const rightObjects = await listObjects(right, namespace);

        const objects = diffObjects(leftObjects, rightObjects);

        const shared = leftObjects
          .filter((o) => rightObjects.some((r) => r.name === o.name && r.namespace === o.namespace))
          .filter((o) => !tables?.length || tables.includes(o.name));

        const deep = shared.slice(0, MAX_DEEP_TABLES);
        const diffs: SchemaDiff["tables"] = [];
        let identical = 0;

        for (const object of deep) {
          const [leftDetail, rightDetail] = [
            await describeObject(left, object.namespace, object.name),
            await describeObject(right, object.namespace, object.name),
          ];
          const diff = diffTable(leftDetail, rightDetail);
          if (diff) diffs.push(diff);
          else identical++;
        }

        const result: SchemaDiff = { objects, tables: diffs, identical };

        return Response.json({
          ...result,
          left: { id: leftRef.id, label: leftRef.label },
          right: { id: rightRef.id, label: rightRef.label },
          summary: formatDiff(result, leftRef.label, rightRef.label),
          // Say so rather than quietly comparing a subset.
          truncated: shared.length > deep.length ? shared.length - deep.length : 0,
        });
      } catch (err) {
        return dbFailure(err);
      }
    } }),
    response: (result) => result as Response,
  })(req);
}, "db.diff");
