import { withErrorHandler } from "../../../../../lib/api-utils";
import { describeObject } from "../../../../../lib/db/introspect";
import { describeIdentity, resolveRowIdentity } from "../../../../../lib/db/identity";
import { dbError, dbFailure, requireAuth, withConnection, type ConnectionParams } from "../../_shared";
import { httpAction } from "../../../../../lib/actions/http";
import { dbTable } from "../../../../../../../../packages/shared/actions/db";


/**
 * Everything the Structure tab shows for one table or collection — columns,
 * indexes, constraints, relations, DDL — plus whether its rows can be edited.
 *
 * Row identity ships with the description rather than as a separate call
 * because the grid needs both to render at all: without an identity it must
 * disable editing, and it should not have to make a second round trip to learn
 * that.
 */
export const GET = withErrorHandler(async (req: Request, { params }: ConnectionParams) => {
  const denied = requireAuth(req);
  if (denied) return denied;

  const { id } = await params;
  const resolved = await withConnection(id);
  if (!resolved.ok) return resolved.response;

  const url = new URL(req.url);
  const name = url.searchParams.get("name");
  const namespace = url.searchParams.get("namespace");
  if (!name) return dbError("A 'name' query parameter is required.", 400);
  if (!namespace) return dbError("A 'namespace' query parameter is required.", 400);

  return httpAction(dbTable, {
    input: () => ({ connectionId: id, namespace, name }),
    context: () => ({ run: async (input) => {
      try {
        const detail = await describeObject(input.connectionId, input.namespace, input.name);
        const identity = resolveRowIdentity(resolved.connection.engine, detail);

        return Response.json({
          ...detail,
          editable: identity.ok && resolved.connection.accessMode === "write",
          identity: identity.ok
            ? { ...identity.identity, description: describeIdentity(identity.identity) }
            : null,
          // Two different reasons editing can be off, and the UI should say which:
          // there is no way to identify a row, or you are on a read connection.
          notEditableReason: !identity.ok
            ? identity.refusal.reason
            : resolved.connection.accessMode === "read"
              ? `'${resolved.connection.label}' is a read-only connection.`
              : undefined,
        });
      } catch (err) {
        return dbFailure(err);
      }
    } }),
    response: (result) => result as Response,
  })(req);
}, "db.table");
