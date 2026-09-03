import { describe, expect, it } from "vitest";
import {
  buildDelete,
  buildInsert,
  buildMutationPlan,
  buildUpdate,
  describePlan,
  DbMutationError,
} from "./mutate";
import type { DbRowIdentity } from "./identity";

const pk: DbRowIdentity = { columns: ["id"], source: "primary-key", hidden: false };
const composite: DbRowIdentity = {
  columns: ["tenant", "id"],
  source: "primary-key",
  hidden: false,
};

describe("buildUpdate", () => {
  it("parameterises every value", () => {
    const { sql, params } = buildUpdate(
      "postgres",
      "public",
      "posts",
      { rowIndex: 0, key: { id: 7 }, changes: { title: "new" } },
      pk,
    );
    expect(sql).toBe('UPDATE "public"."posts" SET "title" = $1 WHERE "id" = $2');
    expect(params).toEqual(["new", 7]);
  });

  /**
   * The value is the injection surface, and it never reaches the SQL text.
   */
  it("keeps a hostile value out of the statement", () => {
    const { sql, params } = buildUpdate(
      "postgres",
      "public",
      "posts",
      { rowIndex: 0, key: { id: 1 }, changes: { title: "'); DROP TABLE posts; --" } },
      pk,
    );
    expect(sql).not.toContain("DROP");
    expect(params[0]).toBe("'); DROP TABLE posts; --");
  });

  it("uses ? placeholders for SQLite and does not qualify the namespace", () => {
    const { sql } = buildUpdate(
      "sqlite",
      "main",
      "posts",
      { rowIndex: 0, key: { id: 1 }, changes: { title: "x" } },
      pk,
    );
    expect(sql).toBe('UPDATE "posts" SET "title" = ? WHERE "id" = ?');
  });

  it("handles a composite key", () => {
    const { sql, params } = buildUpdate(
      "postgres",
      "public",
      "posts",
      { rowIndex: 0, key: { tenant: "acme", id: 3 }, changes: { title: "x" } },
      composite,
    );
    expect(sql).toBe('UPDATE "public"."posts" SET "title" = $1 WHERE "tenant" = $2 AND "id" = $3');
    expect(params).toEqual(["x", "acme", 3]);
  });

  it("sets multiple columns in one statement", () => {
    const { params } = buildUpdate(
      "postgres",
      "public",
      "posts",
      { rowIndex: 0, key: { id: 1 }, changes: { title: "a", views: 2 } },
      pk,
    );
    expect(params).toEqual(["a", 2, 1]);
  });

  it("can set a value to NULL", () => {
    const { sql, params } = buildUpdate(
      "postgres",
      "public",
      "posts",
      { rowIndex: 0, key: { id: 1 }, changes: { published_at: null } },
      pk,
    );
    expect(sql).toContain('"published_at" = $1');
    expect(params[0]).toBeNull();
  });

  /**
   * `= NULL` matches nothing, so a row whose key is NULL cannot be targeted —
   * the update would silently affect zero rows and report success.
   */
  it("refuses a NULL identity value", () => {
    expect(() =>
      buildUpdate(
        "postgres",
        "public",
        "posts",
        { rowIndex: 0, key: { id: null }, changes: { title: "x" } },
        pk,
      ),
    ).toThrow(/NULL/);
  });

  it("refuses a missing identity value", () => {
    expect(() =>
      buildUpdate("postgres", "public", "posts", { rowIndex: 0, key: {}, changes: { title: "x" } }, pk),
    ).toThrow(DbMutationError);
  });

  it("refuses an empty change set", () => {
    expect(() =>
      buildUpdate("postgres", "public", "posts", { rowIndex: 0, key: { id: 1 }, changes: {} }, pk),
    ).toThrow(/No changes/);
  });

  it("escapes quotes in identifiers", () => {
    const { sql } = buildUpdate(
      "postgres",
      "public",
      'we"ird',
      { rowIndex: 0, key: { id: 1 }, changes: { 'col"umn': "x" } },
      pk,
    );
    expect(sql).toContain('"we""ird"');
    expect(sql).toContain('"col""umn"');
  });
});

describe("buildDelete", () => {
  it("targets by identity only", () => {
    const { sql, params } = buildDelete("postgres", "public", "posts", { key: { id: 9 } }, pk);
    expect(sql).toBe('DELETE FROM "public"."posts" WHERE "id" = $1');
    expect(params).toEqual([9]);
  });

  it("refuses a NULL identity", () => {
    expect(() =>
      buildDelete("postgres", "public", "posts", { key: { id: null } }, pk),
    ).toThrow(/NULL/);
  });
});

describe("buildInsert", () => {
  it("parameterises the values", () => {
    const { sql, params } = buildInsert("postgres", "public", "posts", { title: "x", views: 0 });
    expect(sql).toBe('INSERT INTO "public"."posts" ("title", "views") VALUES ($1, $2)');
    expect(params).toEqual(["x", 0]);
  });

  it("refuses an empty row", () => {
    expect(() => buildInsert("postgres", "public", "posts", {})).toThrow(DbMutationError);
  });
});

describe("buildMutationPlan", () => {
  const base = {
    engine: "postgres" as const,
    namespace: "public",
    table: "posts",
    identity: pk,
    updates: [],
    deletes: [],
    inserts: [],
  };

  /**
   * Inserts first so a new row can be edited in the same apply; deletes last so
   * an update to a row you also deleted is not a mid-transaction no-op.
   */
  it("orders inserts, then updates, then deletes", () => {
    const plan = buildMutationPlan({
      ...base,
      inserts: [{ title: "new" }],
      updates: [{ rowIndex: 0, key: { id: 1 }, changes: { title: "edited" } }],
      deletes: [{ key: { id: 2 } }],
    });
    expect(plan.statements.map((s) => s.sql.split(" ")[0])).toEqual([
      "INSERT",
      "UPDATE",
      "DELETE",
    ]);
    expect(plan.expectedRows).toBe(3);
  });

  it("renders a preview with values inlined", () => {
    const plan = buildMutationPlan({
      ...base,
      updates: [{ rowIndex: 0, key: { id: 1 }, changes: { title: "O'Hara" } }],
    });
    // Escaped, because the preview is copyable and should be valid SQL.
    expect(plan.preview).toBe(`UPDATE "public"."posts" SET "title" = 'O''Hara' WHERE "id" = 1;`);
  });

  it("refuses to build anything without a row identity", () => {
    expect(() =>
      buildMutationPlan({
        ...base,
        identity: { columns: [], source: "primary-key", hidden: false },
        updates: [{ rowIndex: 0, key: {}, changes: { a: 1 } }],
      }),
    ).toThrow(/no usable row identity/);
  });

  it("refuses an empty change set", () => {
    expect(() => buildMutationPlan(base)).toThrow(/Nothing staged/);
  });
});

describe("describePlan", () => {
  it("summarises the change set", () => {
    expect(
      describePlan({
        inserts: [{}],
        updates: [{ rowIndex: 0, key: {}, changes: {} }, { rowIndex: 1, key: {}, changes: {} }],
        deletes: [],
      }),
    ).toBe("1 insert, 2 updates");
  });

  it("says so when nothing is staged", () => {
    expect(describePlan({ inserts: [], updates: [], deletes: [] })).toBe("no changes");
  });
});
