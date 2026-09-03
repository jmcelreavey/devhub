/**
 * Which columns identify a row?
 *
 * The question inline editing turns on. An `UPDATE` needs a WHERE clause that
 * matches exactly the row the user edited, and there is no safe default: a
 * WHERE built from every visible column matches duplicates, and a WHERE built
 * from a guessed key matches the wrong row. Both fail silently, on production
 * data, in a way the grid will happily show as success.
 *
 * So when no identity exists, editing is **disabled with a reason** rather than
 * approximated. That is the whole point of this module.
 *
 * Pure — no I/O — so it is unit-testable and importable from client components
 * that need to know whether to render an editable cell.
 */

import type { DbColumnInfo, DbIndexInfo, DbObjectDetail } from "./introspect-types";
import type { DbEngine } from "./types";

export interface DbRowIdentity {
  /** Columns forming the key, in order. */
  columns: string[];
  /** How the key was found — shown in the UI when it is not a primary key. */
  source: "primary-key" | "unique-index" | "rowid" | "object-id";
  /**
   * True when the identity column is not part of the visible result and has to
   * be selected explicitly (Postgres `ctid`, SQLite `rowid`).
   */
  hidden: boolean;
}

export interface DbIdentityRefusal {
  /** Why this table cannot be edited, in words the UI can show verbatim. */
  reason: string;
}

export type DbIdentityResult =
  | { ok: true; identity: DbRowIdentity }
  | { ok: false; refusal: DbIdentityRefusal };

/**
 * Postgres' physical row address.
 *
 * A last resort, and correct only within a single transaction: `ctid` changes
 * when a row is updated or the table is vacuumed. Good enough for "edit the row
 * I am looking at, now", which is what the grid does — and materially better
 * than matching on every column, which silently updates duplicates.
 */
const PG_ROWID = "ctid";

/** SQLite's equivalent, and a stable one unless the table is `WITHOUT ROWID`. */
const SQLITE_ROWID = "rowid";

function primaryKeyColumns(columns: DbColumnInfo[]): string[] {
  return columns.filter((c) => c.primaryKey).map((c) => c.name);
}

/**
 * A unique index is only usable as an identity if none of its columns is
 * nullable — SQL's `NULL != NULL` means a WHERE on a null column matches
 * nothing, so the update would silently affect no rows.
 */
function usableUniqueIndex(
  indexes: DbIndexInfo[],
  columns: DbColumnInfo[],
): DbIndexInfo | undefined {
  const nullable = new Set(columns.filter((c) => c.nullable).map((c) => c.name));
  return indexes.find(
    (ix) =>
      ix.unique &&
      !ix.primary &&
      ix.columns.length > 0 &&
      ix.columns.every((c) => !nullable.has(c) && !c.startsWith("(")),
  );
}

export function resolveRowIdentity(
  engine: DbEngine,
  detail: Pick<DbObjectDetail, "columns" | "indexes" | "kind">,
): DbIdentityResult {
  if (detail.kind === "view" || detail.kind === "materialized-view") {
    return {
      ok: false,
      refusal: {
        reason:
          "This is a view. Edit the underlying table instead — an update here would be ambiguous or rejected.",
      },
    };
  }

  if (engine === "mongodb") {
    const hasId = detail.columns.some((c) => c.name === "_id");
    return hasId
      ? { ok: true, identity: { columns: ["_id"], source: "object-id", hidden: false } }
      : {
          ok: false,
          refusal: { reason: "No _id field was found in the sampled documents." },
        };
  }

  const pk = primaryKeyColumns(detail.columns);
  if (pk.length > 0) {
    return { ok: true, identity: { columns: pk, source: "primary-key", hidden: false } };
  }

  const unique = usableUniqueIndex(detail.indexes, detail.columns);
  if (unique) {
    return { ok: true, identity: { columns: unique.columns, source: "unique-index", hidden: false } };
  }

  if (engine === "postgres") {
    return { ok: true, identity: { columns: [PG_ROWID], source: "rowid", hidden: true } };
  }

  if (engine === "sqlite") {
    // Reaching here means no primary key was found, and SQLite requires one for
    // a WITHOUT ROWID table — so this table has a rowid.
    return { ok: true, identity: { columns: [SQLITE_ROWID], source: "rowid", hidden: true } };
  }

  return {
    ok: false,
    refusal: {
      reason:
        "No primary key or usable unique index. DevHub will not guess a row identity, so editing is disabled here.",
    },
  };
}

/** Human explanation of an identity, for the grid's footer. */
export function describeIdentity(identity: DbRowIdentity): string {
  const columns = identity.columns.join(", ");
  switch (identity.source) {
    case "primary-key":
      return `Rows identified by primary key (${columns}).`;
    case "unique-index":
      return `No primary key — rows identified by the unique index on (${columns}).`;
    case "object-id":
      return "Rows identified by _id.";
    case "rowid":
      return `No primary key — rows identified by the physical ${columns}, which is only stable until the row is updated or the table is vacuumed.`;
  }
}
