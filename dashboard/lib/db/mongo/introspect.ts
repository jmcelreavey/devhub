/**
 * Reading a MongoDB database's shape.
 *
 * There is no schema to read, so "structure" here means two different things
 * and the UI has to be honest about which is which:
 *
 * - **Indexes** are real. `listIndexes` returns what the server enforces.
 * - **Columns** are inferred from a sample of documents. That is a description
 *   of what happens to be there, not a constraint — so `DbObjectDetail.inferred`
 *   is set and the UI says "sampled from N documents" rather than presenting it
 *   as a schema.
 *
 * Sampling uses `$sample`, which reads a random subset rather than the first N.
 * The first N would be biased towards the oldest documents, which on a
 * long-lived collection is exactly the shape that no longer applies.
 */

import { runStatement } from "../pool";
import { DB_METADATA_TIMEOUT_MS } from "../timeouts";
import type {
  DbColumnInfo,
  DbIndexInfo,
  DbNamespace,
  DbObjectDetail,
  DbObjectSummary,
} from "../introspect-types";

/**
 * How many documents to sample when inferring a collection's shape.
 *
 * Big enough to catch fields that appear in a minority of documents, small
 * enough that opening the Structure tab on a prd collection is not itself an
 * event.
 */
export const MONGO_SAMPLE_SIZE = 200;

async function run(connectionId: string, statement: string, rowLimit = 5_000) {
  return runStatement(connectionId, statement, {
    readOnly: true,
    timeoutMs: DB_METADATA_TIMEOUT_MS,
    rowLimit,
  });
}

/** Rebuild documents from the adapter's columns/rows so we can walk their keys. */
function toDocuments(result: { columns: { name: string }[]; rows: unknown[][] }) {
  return result.rows.map((row) =>
    Object.fromEntries(result.columns.map((col, i) => [col.name, row[i]])),
  );
}

export async function listNamespaces(databaseName: string): Promise<DbNamespace[]> {
  // The driver is bound to one database by the connection URI, so there is
  // exactly one namespace and switching means a different connection.
  return [{ name: databaseName, system: false }];
}

export async function listObjects(
  connectionId: string,
  databaseName: string,
): Promise<DbObjectSummary[]> {
  const result = await run(
    connectionId,
    JSON.stringify({ collection: "*", operation: "listCollections" }),
  );

  return toDocuments(result)
    .map((doc) => ({
      namespace: databaseName,
      name: String(doc.name),
      kind: (doc.type === "view" ? "view" : "collection") as DbObjectSummary["kind"],
    }))
    // `system.*` collections are the server's own bookkeeping.
    .filter((o) => !o.name.startsWith("system."))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function describeObject(
  connectionId: string,
  databaseName: string,
  collection: string,
): Promise<DbObjectDetail> {
  const [columns, indexes, estimatedRows] = await Promise.all([
    inferColumns(connectionId, collection),
    describeIndexes(connectionId, collection),
    estimateCount(connectionId, collection),
  ]);

  return {
    namespace: databaseName,
    name: collection,
    kind: "collection",
    columns,
    indexes,
    // MongoDB has no foreign keys or constraints to report. Empty arrays rather
    // than optional fields, so the UI renders "none" instead of nothing.
    foreignKeys: [],
    referencedBy: [],
    constraints: [],
    estimatedRows,
    inferred: true,
    sampleSize: MONGO_SAMPLE_SIZE,
  };
}

/**
 * Infer a column list from sampled documents.
 *
 * Nested objects are flattened one level (`author.name`) because that is where
 * most of the useful structure lives and unbounded recursion on a deeply nested
 * document produces a column list nobody can read.
 */
async function inferColumns(connectionId: string, collection: string): Promise<DbColumnInfo[]> {
  const result = await run(
    connectionId,
    JSON.stringify({
      collection,
      operation: "aggregate",
      pipeline: [{ $sample: { size: MONGO_SAMPLE_SIZE } }],
      limit: MONGO_SAMPLE_SIZE,
    }),
    MONGO_SAMPLE_SIZE,
  );

  const documents = toDocuments(result);
  if (documents.length === 0) return [];

  const seen = new Map<string, { types: Set<string>; count: number }>();

  const visit = (value: unknown, prefix: string, depth: number) => {
    const entry = seen.get(prefix) ?? { types: new Set<string>(), count: 0 };
    entry.types.add(describeType(value));
    entry.count++;
    seen.set(prefix, entry);

    if (depth >= 1) return;
    const nested = parseNestedObject(value);
    if (!nested) return;
    for (const [key, child] of Object.entries(nested)) {
      visit(child, `${prefix}.${key}`, depth + 1);
    }
  };

  for (const doc of documents) {
    for (const [key, value] of Object.entries(doc)) visit(value, key, 0);
  }

  const total = documents.length;
  return [...seen.entries()]
    .map(([name, info], index) => ({
      name,
      // Several types on one field is normal in Mongo and worth surfacing —
      // it is usually how you find the field that changed meaning last year.
      dataType: [...info.types].sort().join(" | "),
      // "Nullable" here means "not present in every sampled document". Named
      // in the comment rather than the field because the UI column is shared
      // with the engines where it is a real constraint.
      nullable: info.count < total,
      position: index + 1,
      primaryKey: name === "_id",
    }))
    .sort((a, b) => (a.name === "_id" ? -1 : b.name === "_id" ? 1 : a.name.localeCompare(b.name)));
}

/**
 * The adapter stringifies plain objects and arrays on the way out, so a nested
 * document arrives as JSON text. Parse it back to walk one level in.
 */
function parseNestedObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || !value.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function describeType(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return Number.isInteger(value) ? "int" : "double";
  if (typeof value === "boolean") return "bool";
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return "date";
    if (/^[0-9a-f]{24}$/i.test(value)) return "objectId";
    if (value.startsWith("[")) return "array";
    if (value.startsWith("{")) return "object";
    return "string";
  }
  if (Array.isArray(value)) return "array";
  return "object";
}

async function describeIndexes(connectionId: string, collection: string): Promise<DbIndexInfo[]> {
  const result = await run(
    connectionId,
    JSON.stringify({ collection, operation: "listIndexes" }),
  );

  return toDocuments(result).map((doc) => {
    const key = parseNestedObject(doc.key) ?? {};
    return {
      name: String(doc.name),
      columns: Object.entries(key).map(([field, direction]) => `${field} ${direction === -1 ? "desc" : "asc"}`),
      unique: doc.unique === true || doc.unique === "true",
      // Mongo's `_id_` index is the primary key in everything but name.
      primary: doc.name === "_id_",
      definition: JSON.stringify(key),
    } satisfies DbIndexInfo;
  });
}

/**
 * `estimatedDocumentCount` reads collection metadata rather than scanning, so
 * it is instant on any size of collection. It can lag after an unclean
 * shutdown, which is an acceptable trade for not running `count(*)` on prd.
 */
async function estimateCount(connectionId: string, collection: string): Promise<number | undefined> {
  try {
    const result = await run(
      connectionId,
      JSON.stringify({ collection, operation: "estimatedDocumentCount" }),
      1,
    );
    const value = result.rows[0]?.[0];
    return typeof value === "number" ? value : undefined;
  } catch {
    return undefined;
  }
}
