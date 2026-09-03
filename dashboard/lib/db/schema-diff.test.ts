import { describe, expect, it } from "vitest";
import {
  diffColumns,
  diffIndexes,
  diffObjects,
  diffTable,
  formatDiff,
  normaliseType,
} from "./schema-diff";
import type { DbColumnInfo, DbObjectDetail, DbObjectSummary } from "./introspect-types";

const table = (name: string, namespace = "public"): DbObjectSummary => ({
  namespace,
  name,
  kind: "table",
});

const column = (over: Partial<DbColumnInfo> & { name: string }): DbColumnInfo => ({
  dataType: "text",
  nullable: true,
  position: 1,
  primaryKey: false,
  ...over,
});

const detail = (over: Partial<DbObjectDetail> = {}): DbObjectDetail => ({
  namespace: "public",
  name: "posts",
  kind: "table",
  columns: [],
  indexes: [],
  foreignKeys: [],
  referencedBy: [],
  constraints: [],
  ...over,
});

describe("diffObjects", () => {
  it("reports tables present on one side only", () => {
    expect(diffObjects([table("a"), table("b")], [table("a"), table("c")])).toEqual([
      { namespace: "public", name: "b", missingFrom: "right" },
      { namespace: "public", name: "c", missingFrom: "left" },
    ]);
  });

  it("reports nothing when both sides match", () => {
    expect(diffObjects([table("a")], [table("a")])).toEqual([]);
  });

  it("treats the same name in different schemas as different tables", () => {
    expect(diffObjects([table("a", "public")], [table("a", "archive")])).toHaveLength(2);
  });
});

describe("normaliseType", () => {
  /** `int4` vs `integer` is the same column, and must not read as a difference. */
  it("collapses Postgres type aliases", () => {
    expect(normaliseType("integer")).toBe(normaliseType("int4"));
    expect(normaliseType("character varying(20)")).toBe(normaliseType("varchar(20)"));
    expect(normaliseType("timestamp with time zone")).toBe(normaliseType("timestamptz"));
    expect(normaliseType("BOOLEAN")).toBe(normaliseType("bool"));
  });

  /** Length is part of the type; varchar(20) and varchar(40) genuinely differ. */
  it("keeps the length suffix", () => {
    expect(normaliseType("varchar(20)")).not.toBe(normaliseType("varchar(40)"));
  });
});

describe("diffColumns", () => {
  it("reports a missing column on each side", () => {
    const diffs = diffColumns([column({ name: "a" }), column({ name: "b" })], [column({ name: "a" })]);
    expect(diffs).toEqual([{ column: "b", kind: "missing", missingFrom: "right" }]);
  });

  it("reports a type change", () => {
    const diffs = diffColumns(
      [column({ name: "views", dataType: "int4" })],
      [column({ name: "views", dataType: "int8" })],
    );
    expect(diffs).toEqual([{ column: "views", kind: "type", left: "int4", right: "int8" }]);
  });

  it("does not report an aliased type as a change", () => {
    expect(
      diffColumns(
        [column({ name: "views", dataType: "integer" })],
        [column({ name: "views", dataType: "int4" })],
      ),
    ).toEqual([]);
  });

  /** The classic dev/prd divergence: a column that is NOT NULL in only one. */
  it("reports a nullability change", () => {
    const diffs = diffColumns(
      [column({ name: "email", nullable: true })],
      [column({ name: "email", nullable: false })],
    );
    expect(diffs[0]).toMatchObject({ column: "email", kind: "nullable" });
  });

  it("reports a default change", () => {
    const diffs = diffColumns(
      [column({ name: "status", defaultValue: "'draft'" })],
      [column({ name: "status" })],
    );
    expect(diffs[0]).toMatchObject({ kind: "default", left: "'draft'", right: "none" });
  });
});

describe("diffIndexes", () => {
  const index = (name: string, columns: string[], unique = false) => ({
    name,
    columns,
    unique,
    primary: false,
  });

  /**
   * Index names diverge between environments for reasons nobody cares about.
   * What matters is whether the same columns are covered.
   */
  it("matches by covered columns, not by name", () => {
    expect(
      diffIndexes([index("ix_posts_status", ["status"])], [index("posts_status_idx", ["status"])]),
    ).toEqual([]);
  });

  it("ignores column order within an index signature", () => {
    expect(diffIndexes([index("a", ["x", "y"])], [index("b", ["y", "x"])])).toEqual([]);
  });

  it("reports an index missing from one side", () => {
    const diffs = diffIndexes([index("ix", ["status"])], []);
    expect(diffs).toEqual([
      { name: "ix", missingFrom: "right", columns: ["status"], unique: false },
    ]);
  });

  /** Unique and non-unique over the same columns are not the same index. */
  it("distinguishes unique from non-unique", () => {
    expect(diffIndexes([index("a", ["email"], true)], [index("b", ["email"], false)])).toHaveLength(2);
  });
});

describe("diffTable", () => {
  it("returns null when the tables match", () => {
    expect(diffTable(detail({ columns: [column({ name: "a" })] }), detail({ columns: [column({ name: "a" })] }))).toBeNull();
  });

  it("returns the differences when they do not", () => {
    const diff = diffTable(
      detail({ columns: [column({ name: "a" })] }),
      detail({ columns: [column({ name: "a", nullable: false })] }),
    );
    expect(diff?.columns).toHaveLength(1);
  });
});

describe("formatDiff", () => {
  it("names which side is missing what", () => {
    const text = formatDiff(
      {
        objects: [{ namespace: "public", name: "audit", missingFrom: "right" }],
        tables: [
          {
            namespace: "public",
            name: "posts",
            columns: [{ column: "slug", kind: "missing", missingFrom: "right" }],
            indexes: [],
          },
        ],
        identical: 3,
      },
      "capi · dev",
      "capi · prd",
    );
    expect(text).toContain("table public.audit — missing from capi · prd");
    expect(text).toContain("column public.posts.slug — missing from capi · prd");
  });

  /** The reassuring half of the answer: "I checked, and they match." */
  it("says so when nothing differs", () => {
    expect(formatDiff({ objects: [], tables: [], identical: 12 }, "dev", "prd")).toBe(
      "No structural differences across 12 compared table(s).",
    );
  });
});
