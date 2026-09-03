/**
 * One introspection entry point, dispatching by engine.
 *
 * Routes and MCP tools call this and never an engine module directly, so
 * "describe this table" means the same thing regardless of what is behind the
 * connection — and adding an engine does not mean touching every caller.
 */

import { findDbConnection } from "./registry";
import { DbConnectionNotFoundError } from "./provider";
import type { DbNamespace, DbObjectDetail, DbObjectSummary } from "./introspect-types";
import type { DbEngine } from "./types";

import * as postgres from "./postgres/introspect";
import * as sqlite from "./sqlite/introspect";
import * as mongo from "./mongo/introspect";

async function engineOf(connectionId: string): Promise<{ engine: DbEngine; label: string }> {
  const connection = await findDbConnection(connectionId);
  if (!connection) throw new DbConnectionNotFoundError(connectionId);
  return { engine: connection.engine, label: connection.label };
}

/**
 * MongoDB's namespace is its database, which the URI already pins.
 *
 * Providers expose the bound database as safe connection metadata. Parsing the
 * connection id is wrong for named targets such as `bi:mongo:fantasy-stocks:dev`.
 */
export async function mongoDatabaseName(connectionId: string): Promise<string> {
  const connection = await findDbConnection(connectionId);
  if (!connection) throw new DbConnectionNotFoundError(connectionId);
  return connection.database ?? "database";
}

export async function listNamespaces(connectionId: string): Promise<DbNamespace[]> {
  const { engine } = await engineOf(connectionId);
  if (engine === "postgres") return postgres.listNamespaces(connectionId);
  if (engine === "sqlite") return sqlite.listNamespaces();
  return mongo.listNamespaces(await mongoDatabaseName(connectionId));
}

export async function listObjects(
  connectionId: string,
  namespace?: string,
): Promise<DbObjectSummary[]> {
  const { engine } = await engineOf(connectionId);
  if (engine === "postgres") return postgres.listObjects(connectionId, namespace);
  if (engine === "sqlite") return sqlite.listObjects(connectionId);
  return mongo.listObjects(connectionId, namespace ?? (await mongoDatabaseName(connectionId)));
}

export async function describeObject(
  connectionId: string,
  namespace: string,
  name: string,
): Promise<DbObjectDetail> {
  const { engine } = await engineOf(connectionId);
  if (engine === "postgres") return postgres.describeObject(connectionId, namespace, name);
  if (engine === "sqlite") return sqlite.describeObject(connectionId, name);
  return mongo.describeObject(connectionId, namespace, name);
}

/** Whole-database summary for the schema tree's first paint. */
export interface DbSchemaSnapshot {
  engine: DbEngine;
  namespaces: DbNamespace[];
  objects: DbObjectSummary[];
}

export async function describeSchema(
  connectionId: string,
  namespace?: string,
): Promise<DbSchemaSnapshot> {
  const { engine } = await engineOf(connectionId);
  const [namespaces, objects] = await Promise.all([
    listNamespaces(connectionId),
    listObjects(connectionId, namespace),
  ]);
  return { engine, namespaces, objects };
}
