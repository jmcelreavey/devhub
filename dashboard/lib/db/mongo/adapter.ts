/**
 * The MongoDB engine.
 *
 * No `BEGIN READ ONLY` exists here, so read-only cannot be a mode we ask the
 * server for — it has to be a property of never issuing a mutating command.
 * That makes the allowlist in `command.ts` load-bearing rather than advisory,
 * and it is why this adapter dispatches through an explicit `switch` with no
 * generic `runCommand` escape hatch: a driver method that is not written out
 * below cannot be reached at all.
 *
 * Auth is MONGODB-AWS (SigV4) with STS session credentials baked into the URI
 * by the BI provider — the driver speaks it natively, so nothing here handles
 * credentials.
 */

import type { Collection, Db, Document, MongoClient } from "mongodb";
import type { DbClient, DbEngineAdapter, DbRunOptions } from "../adapter";
import { DB_CONNECT_TIMEOUT_MS } from "../timeouts";
import type { DbColumn, DbResultSet, ResolvedDbConnection } from "../types";
import {
  classifyMongoCommand,
  MongoCommandError,
  parseMongoCommand,
  type MongoCommand,
} from "./command";

interface MongoConnection {
  client: MongoClient;
  db: Db;
  databaseName: string;
}

async function mongo() {
  return import("mongodb");
}

/**
 * Revive the tags `parseRelaxedJson` produced.
 *
 * `ObjectId("…")` became `{ $oid: "…" }` during parsing because the parser must
 * not evaluate anything. Turning it back into a real ObjectId has to happen
 * here, where the driver's types are available — and it has to happen, or
 * `find({_id: ObjectId("…")})` silently matches nothing, which is the single
 * most confusing possible failure.
 */
async function reviveExtendedJson(value: unknown): Promise<unknown> {
  const { ObjectId } = await mongo();

  const walk = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(walk);
    if (!input || typeof input !== "object") return input;

    const entries = Object.entries(input as Record<string, unknown>);
    if (entries.length === 1) {
      const [key, raw] = entries[0];
      if (key === "$oid" && typeof raw === "string") return new ObjectId(raw);
      if (key === "$date" && typeof raw === "string") return new Date(raw);
    }
    return Object.fromEntries(entries.map(([k, v]) => [k, walk(v)]));
  };

  return walk(value);
}

/**
 * Flatten documents into the grid's columns/rows.
 *
 * Mongo documents are not rectangular, so the column set is the union of keys
 * across the returned documents, in first-seen order. `_id` is pulled to the
 * front because it is the row identity and the thing you look for first.
 */
function toResultSet(documents: Document[], statement: string, started: number, truncated: boolean): DbResultSet {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const doc of documents) {
    for (const key of Object.keys(doc)) {
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(key);
    }
  }
  names.sort((a, b) => (a === "_id" ? -1 : b === "_id" ? 1 : 0));

  const columns: DbColumn[] = names.map((name) => ({ name }));
  const rows = documents.map((doc) => names.map((name) => toCellValue(doc[name])));

  return { columns, rows, truncated, durationMs: Date.now() - started, statement };
}

function toCellValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "object") {
    // ObjectId, Decimal128, Binary and friends all render usefully via
    // toString; plain objects and arrays need their structure preserved.
    const proto = Object.getPrototypeOf(value) as object | null;
    const isPlain = proto === Object.prototype || proto === null || Array.isArray(value);
    return isPlain ? JSON.stringify(value) : String(value);
  }
  return value;
}

/** A single-column, single-row result — for counts and acknowledgements. */
function scalarResult(name: string, value: unknown, statement: string, started: number): DbResultSet {
  return {
    columns: [{ name }],
    rows: [[toCellValue(value)]],
    truncated: false,
    durationMs: Date.now() - started,
    statement,
  };
}

export const mongoAdapter: DbEngineAdapter = {
  engine: "mongodb",

  async open(resolved: ResolvedDbConnection): Promise<DbClient> {
    const target = resolved.mongodb;
    if (!target) throw new Error("Connection is not a MongoDB target.");

    const { MongoClient: Client } = await mongo();
    const client = new Client(target.uri, {
      serverSelectionTimeoutMS: DB_CONNECT_TIMEOUT_MS,
      connectTimeoutMS: DB_CONNECT_TIMEOUT_MS,
      // Identifies a DevHub session in Atlas's own connection view, the way
      // `application_name` does for Postgres.
      appName: "devhub",
    });

    await client.connect();
    return { client, db: client.db(target.database), databaseName: target.database } satisfies MongoConnection;
  },

  async close(handle: DbClient): Promise<void> {
    const conn = handle as MongoConnection;
    await conn.client.close().catch(() => {});
  },

  async ping(handle: DbClient): Promise<void> {
    const conn = handle as MongoConnection;
    await conn.db.command({ ping: 1 });
  },

  async run(handle: DbClient, statement: string, opts: DbRunOptions): Promise<DbResultSet> {
    const conn = handle as MongoConnection;
    const started = Date.now();
    const command = parseMongoCommand(statement);
    const { kind, reason } = classifyMongoCommand(command);

    if (opts.readOnly && kind !== "read") {
      throw new MongoCommandError(
        reason
          ? `This connection is read-only. ${reason}`
          : `This connection is read-only, and '${command.operation}' modifies data.`,
      );
    }

    return execute(conn, command, statement, started, opts);
  },

  /**
   * MongoDB has no out-of-band cancel comparable to `pg_cancel_backend`.
   *
   * Every operation carries `maxTimeMS`, so a runaway query is bounded by the
   * server rather than by us — but there is no honest way to stop one early,
   * and returning true here would put a Cancel button in the UI that does
   * nothing.
   */
  async cancel(): Promise<boolean> {
    return false;
  },
};

async function execute(
  conn: MongoConnection,
  command: MongoCommand,
  statement: string,
  started: number,
  opts: DbRunOptions,
): Promise<DbResultSet> {
  const collection: Collection<Document> = conn.db.collection(command.collection);
  const maxTimeMS = opts.timeoutMs;

  const filter = ((await reviveExtendedJson(command.filter ?? {})) ?? {}) as Document;
  const limit = Math.min(command.limit ?? opts.rowLimit, opts.rowLimit);

  /**
   * Did *our* row cap trim the result, or did the user's own `.limit()`?
   *
   * Only the first is truncation. Reporting `.limit(2)` returning two rows as
   * "truncated" tells the user their result is incomplete when it is exactly
   * what they asked for — which trains them to ignore the flag on the day it
   * matters.
   */
  const cappedByUs = limit >= opts.rowLimit;

  switch (command.operation) {
    case "find": {
      const cursor = collection
        .find(filter, { maxTimeMS })
        .project((command.projection ?? {}) as Document)
        .sort((command.sort ?? {}) as Document)
        .skip(command.skip ?? 0)
        // One extra so we can tell "exactly at the cap" from "more than the
        // cap" without a second count.
        .limit(limit + 1);
      const docs = await cursor.toArray();
      const truncated = docs.length > limit && cappedByUs;
      return toResultSet(truncated ? docs.slice(0, limit) : docs, statement, started, truncated);
    }

    case "findOne": {
      const doc = await collection.findOne(filter, {
        maxTimeMS,
        projection: (command.projection ?? {}) as Document,
      });
      return toResultSet(doc ? [doc] : [], statement, started, false);
    }

    case "aggregate": {
      const pipeline = ((await reviveExtendedJson(command.pipeline ?? [])) ?? []) as Document[];
      const docs = await conn.db
        .collection(command.collection)
        .aggregate(pipeline, { maxTimeMS })
        .limit(limit + 1)
        .toArray();
      const truncated = docs.length > limit && cappedByUs;
      return toResultSet(truncated ? docs.slice(0, limit) : docs, statement, started, truncated);
    }

    case "countDocuments":
      return scalarResult("count", await collection.countDocuments(filter, { maxTimeMS }), statement, started);

    case "estimatedDocumentCount":
      return scalarResult("count", await collection.estimatedDocumentCount({ maxTimeMS }), statement, started);

    case "distinct": {
      if (!command.field) throw new MongoCommandError("distinct needs a field name.");
      const values = await collection.distinct(command.field, filter, { maxTimeMS });
      return {
        columns: [{ name: command.field }],
        rows: values.slice(0, opts.rowLimit).map((v) => [toCellValue(v)]),
        truncated: values.length > opts.rowLimit,
        durationMs: Date.now() - started,
        statement,
      };
    }

    case "listCollections": {
      const docs = await conn.db.listCollections().toArray();
      return toResultSet(docs as Document[], statement, started, false);
    }

    case "listIndexes": {
      const docs = await collection.listIndexes().toArray();
      return toResultSet(docs as Document[], statement, started, false);
    }

    case "insertOne":
    case "insertMany": {
      const docs = ((await reviveExtendedJson(command.documents ?? [])) ?? []) as Document[];
      if (docs.length === 0) throw new MongoCommandError("Nothing to insert.");
      const result = await collection.insertMany(docs);
      return {
        ...scalarResult("insertedCount", result.insertedCount, statement, started),
        rowsAffected: result.insertedCount,
      };
    }

    case "updateOne":
    case "updateMany":
    case "replaceOne": {
      const update = ((await reviveExtendedJson(command.update ?? {})) ?? {}) as Document;
      const result =
        command.operation === "replaceOne"
          ? await collection.replaceOne(filter, update)
          : command.operation === "updateOne"
            ? await collection.updateOne(filter, update)
            : await collection.updateMany(filter, update);
      return {
        columns: [{ name: "matchedCount" }, { name: "modifiedCount" }],
        rows: [[result.matchedCount, result.modifiedCount]],
        rowsAffected: result.modifiedCount,
        truncated: false,
        durationMs: Date.now() - started,
        statement,
      };
    }

    case "deleteOne":
    case "deleteMany": {
      const result =
        command.operation === "deleteOne"
          ? await collection.deleteOne(filter)
          : await collection.deleteMany(filter);
      return {
        ...scalarResult("deletedCount", result.deletedCount, statement, started),
        rowsAffected: result.deletedCount,
      };
    }

    case "createIndex": {
      if (!command.index || typeof command.index === "string") {
        throw new MongoCommandError("createIndex needs an index specification object.");
      }
      const name = await collection.createIndex(command.index as Document);
      return scalarResult("index", name, statement, started);
    }

    case "dropIndex": {
      if (typeof command.index !== "string") {
        throw new MongoCommandError("dropIndex needs an index name.");
      }
      await collection.dropIndex(command.index);
      return scalarResult("dropped", command.index, statement, started);
    }

    case "drop": {
      await collection.drop();
      return scalarResult("dropped", command.collection, statement, started);
    }

    default: {
      // Unreachable while the parser's allowlist and this switch agree — and
      // this is what keeps them honest if they ever stop agreeing.
      const never: never = command.operation;
      throw new MongoCommandError(`Unsupported operation '${String(never)}'.`);
    }
  }
}
