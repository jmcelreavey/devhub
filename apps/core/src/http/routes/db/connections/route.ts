import { withErrorHandler } from "../../../../lib/api-utils";
import { invalidateDbConnections, listDbConnections, listExternalDbConnections } from "../../../../lib/db/registry";
import { closeAllConnections, listOpenConnections } from "../../../../lib/db/pool";
import { emitCoreEvent } from "@devhub/core/events/core-events";
import { createHash } from "node:crypto";
import { requireAuth } from "../_shared";
import { httpAction } from "../../../../lib/actions/http";
import { dbConnections, dbConnectionsReset } from "../../../../../../../packages/shared/actions/db";

const state = globalThis as typeof globalThis & { __devhubDbExternalFingerprint?: string };

/**
 * Every connection this machine could open.
 *
 * Cheap by contract — providers must not shell out here — because the rail
 * refetches it. Provider failures come back in `errors` rather than as a 500:
 * the remote provider being unable to reach GitHub should not hide the local SQLite
 * files.
 */
export const GET = withErrorHandler(async (req: Request) => {
  const denied = requireAuth(req);
  if (denied) return denied;

  if (new URL(req.url).searchParams.get("scope") === "external") {
    const external = await listExternalDbConnections({ refresh: true });
    const fingerprint = createHash("sha256").update(JSON.stringify(external)).digest("hex");
    if (state.__devhubDbExternalFingerprint !== fingerprint) {
      state.__devhubDbExternalFingerprint = fingerprint;
      emitCoreEvent("db");
    }
    return Response.json({ ok: true });
  }

  const refresh = new URL(req.url).searchParams.get("refresh") === "true";
  return httpAction(dbConnections, {
    input: () => ({ refresh }),
    context: () => ({ run: async ({ refresh: requestedRefresh }) => {
      const { connections, errors } = await listDbConnections({ refresh: requestedRefresh });
      const open = new Set(listOpenConnections().map((connection) => connection.connectionId));
      return Response.json({ connections: connections.map((connection) => ({ ...connection, open: open.has(connection.id) })), errors });
    } }),
    response: (result) => result as Response,
  })(req);
}, "db.connections");

/**
 * Drop cached listings and every open connection.
 *
 * Called after an AWS profile switch: connections are derived from access, so
 * when the access changes the list is stale and the pooled sockets are
 * authenticated as somebody else.
 */
export const POST = withErrorHandler(async (req: Request) => {
  const denied = requireAuth(req);
  if (denied) return denied;

  return await dbConnectionsReset.handler({}, { run: async () => {
    await closeAllConnections();
    await invalidateDbConnections();
    const { connections, errors } = await listDbConnections({ refresh: true });
    return Response.json({ connections, errors, reset: true });
  } }) as Response;
}, "db.connections.reset");
