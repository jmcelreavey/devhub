import { parseBody, withErrorHandler } from "../../../../../lib/api-utils";
import { closeConnection } from "../../../../../lib/db/pool";
import { invalidateDbConnections } from "../../../../../lib/db/registry";
import {
  readUserConnections,
  userConnectionId,
  writeUserConnections,
  type StoredUserConnection,
} from "../../../../../lib/db/user-connections";
import { dbDeleteConnection, dbManagedConnections, dbSaveConnection } from "../../../../../../../../packages/shared/actions/db";
import { dbError, requireAuth } from "../../_shared";


/** The user's own saved connections, passwords stripped. */
export const GET = withErrorHandler(async (req: Request) => {
  const denied = requireAuth(req);
  if (denied) return denied;

  // The UI needs to know a password is set, never what it is.
  return await dbManagedConnections.handler(dbManagedConnections.input.parse({}), { run: async () => {
      const connections = readUserConnections().map(({ password, ...rest }) => ({
        ...rest,
        hasPassword: Boolean(password),
      }));
      return Response.json({ connections });
    } }) as Response;
}, "db.connections.manage.get");

/** Create or update one. */
export const PUT = withErrorHandler(async (req: Request) => {
  const denied = requireAuth(req);
  if (denied) return denied;

  const parsed = await parseBody(req, dbSaveConnection.input);
  if (!parsed.ok) return parsed.response;
  return await dbSaveConnection.handler(parsed.data, { run: (input) => saveConnection(input as StoredUserConnection) }) as Response;
}, "db.connections.manage.put");

async function saveConnection(input: StoredUserConnection) {
  const missing = missingField(input);
  if (missing) return dbError(missing, 400);

  const existing = readUserConnections();
  const index = existing.findIndex((c) => c.slug === input.slug);

  // An edit that omits `password` keeps the stored one, so the UI can show a
  // form it never received the secret for without wiping it on save.
  const merged: StoredUserConnection =
    index >= 0 && input.password === undefined
      ? { ...input, password: existing[index].password }
      : input;

  if (index >= 0) existing[index] = merged;
  else existing.push(merged);

  writeUserConnections(existing);
  // Credentials may have changed under an open socket.
  await closeConnection(userConnectionId(input.slug));
  await invalidateDbConnections();

  return Response.json({ ok: true, id: userConnectionId(input.slug) });
}

export const DELETE = withErrorHandler(async (req: Request) => {
  const denied = requireAuth(req);
  if (denied) return denied;

  const slug = new URL(req.url).searchParams.get("slug");
  if (!slug) return dbError("A 'slug' query parameter is required.", 400);

  return await dbDeleteConnection.handler(dbDeleteConnection.input.parse({ slug }), { run: async ({ slug: selectedSlug }) => {
      const remaining = readUserConnections().filter((c) => c.slug !== selectedSlug);
      writeUserConnections(remaining);
      await closeConnection(userConnectionId(selectedSlug));
      await invalidateDbConnections();
      return Response.json({ ok: true });
    } }) as Response;
}, "db.connections.manage.delete");

/** Per-engine required fields, named individually so the error is actionable. */
function missingField(input: StoredUserConnection): string | null {
  if (input.engine === "sqlite" && !input.file) return "A SQLite connection needs a database file.";
  if (input.engine === "mongodb" && !input.uri) return "A MongoDB connection needs a connection URI.";
  if (input.engine === "postgres" && !input.host) return "A PostgreSQL connection needs a host.";
  return null;
}
