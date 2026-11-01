import { describe, expect, it } from "vitest";
import { describeIdentity, resolveRowIdentity } from "./identity";
import type { DbColumnInfo, DbIndexInfo, DbObjectDetail } from "./introspect-types";

const column = (over: Partial<DbColumnInfo> & { name: string }): DbColumnInfo => ({
  dataType: "text",
  nullable: false,
  position: 1,
  primaryKey: false,
  ...over,
});

const index = (over: Partial<DbIndexInfo> & { name: string }): DbIndexInfo => ({
  columns: [],
  unique: false,
  primary: false,
  ...over,
});

const table = (
  columns: DbColumnInfo[],
  indexes: DbIndexInfo[] = [],
  kind: DbObjectDetail["kind"] = "table",
) => ({ columns, indexes, kind });

describe("resolveRowIdentity", () => {
  it("prefers the primary key", () => {
    const result = resolveRowIdentity(
      "postgres",
      table([column({ name: "id", primaryKey: true }), column({ name: "name" })]),
    );
    expect(result).toEqual({
      ok: true,
      identity: { columns: ["id"], source: "primary-key", hidden: false },
    });
  });

  it("keeps composite primary keys in order", () => {
    const result = resolveRowIdentity(
      "postgres",
      table([
        column({ name: "tenant", primaryKey: true, position: 1 }),
        column({ name: "id", primaryKey: true, position: 2 }),
      ]),
    );
    expect(result.ok && result.identity.columns).toEqual(["tenant", "id"]);
  });

  it("falls back to a usable unique index", () => {
    const result = resolveRowIdentity(
      "postgres",
      table([column({ name: "email" })], [index({ name: "ux_email", unique: true, columns: ["email"] })]),
    );
    expect(result.ok && result.identity.source).toBe("unique-index");
  });

  /**
   * NULL never equals NULL, so a WHERE on a nullable unique column matches no
   * rows — the update would silently do nothing and report success.
   */
  it("refuses a unique index over a nullable column", () => {
    const result = resolveRowIdentity(
      "postgres",
      table(
        [column({ name: "email", nullable: true })],
        [index({ name: "ux_email", unique: true, columns: ["email"] })],
      ),
    );
    expect(result.ok && result.identity.source).toBe("rowid");
  });

  it("refuses an expression index as an identity", () => {
    const result = resolveRowIdentity(
      "postgres",
      table(
        [column({ name: "email" })],
        [index({ name: "ux_lower", unique: true, columns: ["(expression)"] })],
      ),
    );
    expect(result.ok && result.identity.source).toBe("rowid");
  });

  it("falls back to ctid on Postgres with no key at all", () => {
    const result = resolveRowIdentity("postgres", table([column({ name: "a" })]));
    expect(result).toEqual({
      ok: true,
      identity: { columns: ["ctid"], source: "rowid", hidden: true },
    });
  });

  it("falls back to rowid on SQLite", () => {
    const result = resolveRowIdentity("sqlite", table([column({ name: "a" })]));
    expect(result.ok && result.identity.columns).toEqual(["rowid"]);
  });

  it("uses _id for MongoDB", () => {
    const result = resolveRowIdentity(
      "mongodb",
      table([column({ name: "_id", primaryKey: true }), column({ name: "title" })], [], "collection"),
    );
    expect(result.ok && result.identity.source).toBe("object-id");
  });

  it("refuses a Mongo collection with no _id in the sample", () => {
    const result = resolveRowIdentity("mongodb", table([column({ name: "title" })], [], "collection"));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.refusal.reason).toMatch(/_id/);
  });

  /** An update against a view is ambiguous at best and rejected at worst. */
  it("refuses views", () => {
    const result = resolveRowIdentity(
      "postgres",
      table([column({ name: "id", primaryKey: true })], [], "view"),
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.refusal.reason).toMatch(/view/i);
  });

  it("refuses materialized views too", () => {
    const result = resolveRowIdentity("postgres", table([], [], "materialized-view"));
    expect(result.ok).toBe(false);
  });
});

describe("describeIdentity", () => {
  it("explains each source in words the grid can show", () => {
    expect(describeIdentity({ columns: ["id"], source: "primary-key", hidden: false })).toMatch(
      /primary key/,
    );
    expect(describeIdentity({ columns: ["email"], source: "unique-index", hidden: false })).toMatch(
      /unique index/,
    );
    expect(describeIdentity({ columns: ["_id"], source: "object-id", hidden: false })).toMatch(/_id/);
    // The caveat matters: ctid moves under UPDATE and VACUUM.
    expect(describeIdentity({ columns: ["ctid"], source: "rowid", hidden: true })).toMatch(
      /only stable until/,
    );
  });
});
