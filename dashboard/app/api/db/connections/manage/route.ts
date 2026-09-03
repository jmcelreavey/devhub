import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { parseBody, withErrorHandler } from "@/lib/api-utils";
import { closeConnection } from "@/lib/db/pool";
import { invalidateDbConnections } from "@/lib/db/registry";
import {
  readUserConnections,
  userConnectionId,
  writeUserConnections,
  type StoredUserConnection,
} from "@/lib/db/user-connections";
import { dbError, requireAuth } from "../../_shared";

export const dynamic = "force-dynamic";

/** Slug rule matches the rest of DevHub — URL- and filename-safe. */
const SLUG = /^[a-z0-9][a-z0-9_-]{0,62}$/;

const ConnectionSchema = z.object({
  slug: z.string().regex(SLUG, "slug must be a lowercase slug"),
  label: z.string().trim().min(1).max(120),
  engine: z.enum(["postgres", "mongodb", "sqlite"]),
  group: z.string().trim().max(60).optional(),
  host: z.string().trim().max(255).optional(),
  port: z.number().int().positive().max(65_535).optional(),
  database: z.string().trim().max(255).optional(),
  user: z.string().trim().max(255).optional(),
  password: z.string().max(2_000).optional(),
  ssl: z.boolean().optional(),
  uri: z.string().trim().max(4_000).optional(),
  file: z.string().trim().max(4_000).optional(),
  /**
   * Defaults to read-only when omitted.
   *
   * A hand-added connection has no external authority to derive access from —
   * unlike a BI connection, whose mode comes from the AWS profile — so the user
   * sets it. Defaulting to read means pointing this at production by mistake is
   * survivable.
   */
  readOnly: z.boolean().optional(),
});

/** The user's own saved connections, passwords stripped. */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const denied = requireAuth(req);
  if (denied) return denied;

  // The UI needs to know a password is set, never what it is.
  const connections = readUserConnections().map(({ password, ...rest }) => ({
    ...rest,
    hasPassword: Boolean(password),
  }));
  return NextResponse.json({ connections });
}, "db.connections.manage.get");

/** Create or update one. */
export const PUT = withErrorHandler(async (req: NextRequest) => {
  const denied = requireAuth(req);
  if (denied) return denied;

  const parsed = await parseBody(req, ConnectionSchema);
  if (!parsed.ok) return parsed.response;
  const input = parsed.data as StoredUserConnection;

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
  invalidateDbConnections();
  // Credentials may have changed under an open socket.
  await closeConnection(userConnectionId(input.slug));

  return NextResponse.json({ ok: true, id: userConnectionId(input.slug) });
}, "db.connections.manage.put");

export const DELETE = withErrorHandler(async (req: NextRequest) => {
  const denied = requireAuth(req);
  if (denied) return denied;

  const slug = new URL(req.url).searchParams.get("slug");
  if (!slug) return dbError("A 'slug' query parameter is required.", 400);

  const remaining = readUserConnections().filter((c) => c.slug !== slug);
  writeUserConnections(remaining);
  invalidateDbConnections();
  await closeConnection(userConnectionId(slug));

  return NextResponse.json({ ok: true });
}, "db.connections.manage.delete");

/** Per-engine required fields, named individually so the error is actionable. */
function missingField(input: StoredUserConnection): string | null {
  if (input.engine === "sqlite" && !input.file) return "A SQLite connection needs a database file.";
  if (input.engine === "mongodb" && !input.uri) return "A MongoDB connection needs a connection URI.";
  if (input.engine === "postgres" && !input.host) return "A PostgreSQL connection needs a host.";
  return null;
}
