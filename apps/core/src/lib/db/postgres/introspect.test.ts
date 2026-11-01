import { describe, expect, it } from "vitest";
import { composeDdl, parsePgArray, qualify, quoteIdent } from "./introspect";

describe("parsePgArray", () => {
  it("passes a real JS array through", () => {
    expect(parsePgArray(["a", "b"])).toEqual(["a", "b"]);
  });

  /** `text[]` arrives JSON-stringified by the adapter's cell renderer. */
  it("parses the JSON form", () => {
    expect(parsePgArray('["author_id","tenant"]')).toEqual(["author_id", "tenant"]);
  });

  /**
   * The regression this exists for: `ARRAY(SELECT a.attname …)` is `name[]`,
   * which has no parser registered in `pg`, so it arrives as a raw Postgres
   * literal. Returning `[]` for it produced `FOREIGN KEY ()` in generated DDL —
   * silently wrong, and invisible until you read the output.
   */
  it("parses the Postgres array literal form", () => {
    expect(parsePgArray("{author_id}")).toEqual(["author_id"]);
    expect(parsePgArray("{tenant,id}")).toEqual(["tenant", "id"]);
  });

  it("handles quoted elements containing commas and spaces", () => {
    expect(parsePgArray('{"col with space","a,b",plain}')).toEqual([
      "col with space",
      "a,b",
      "plain",
    ]);
  });

  it("handles an escaped quote inside an element", () => {
    expect(parsePgArray('{"we\\"ird"}')).toEqual(['we"ird']);
  });

  it("returns empty for an empty array in either form", () => {
    expect(parsePgArray("{}")).toEqual([]);
    expect(parsePgArray("[]")).toEqual([]);
    expect(parsePgArray("")).toEqual([]);
  });

  it("returns empty for anything it does not recognise", () => {
    expect(parsePgArray(null)).toEqual([]);
    expect(parsePgArray(42)).toEqual([]);
    expect(parsePgArray("not an array")).toEqual([]);
  });
});

describe("identifiers", () => {
  it("quotes and escapes", () => {
    expect(quoteIdent("posts")).toBe('"posts"');
    expect(quoteIdent('we"ird')).toBe('"we""ird"');
    expect(qualify("blog", "posts")).toBe('"blog"."posts"');
  });
});

describe("composeDdl", () => {
  const columns = [
    { name: "id", dataType: "bigint", nullable: false, position: 1, primaryKey: true },
    { name: "title", dataType: "text", nullable: false, position: 2, primaryKey: false },
    {
      name: "views",
      dataType: "integer",
      nullable: true,
      position: 3,
      primaryKey: false,
      defaultValue: "0",
    },
  ];

  it("renders columns with nullability and defaults", () => {
    const ddl = composeDdl({
      namespace: "blog",
      name: "posts",
      columns,
      indexes: [],
      foreignKeys: [],
      constraints: [],
    });
    expect(ddl).toContain('CREATE TABLE "blog"."posts" (');
    expect(ddl).toContain('"id" bigint NOT NULL');
    expect(ddl).toContain('"views" integer DEFAULT 0');
  });

  /** The bug's visible symptom: an ALTER with an empty column list. */
  it("names the columns on a foreign key", () => {
    const ddl = composeDdl({
      namespace: "blog",
      name: "posts",
      columns,
      indexes: [],
      foreignKeys: [
        {
          name: "posts_author_id_fkey",
          columns: ["author_id"],
          referencedNamespace: "blog",
          referencedTable: "authors",
          referencedColumns: ["id"],
          onDelete: "CASCADE",
        },
      ],
      constraints: [],
    });
    expect(ddl).toContain(
      'ADD CONSTRAINT "posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "blog"."authors" ("id") ON DELETE CASCADE;',
    );
    expect(ddl).not.toContain("FOREIGN KEY ()");
  });

  it("omits NO ACTION, which is the default and is noise", () => {
    const ddl = composeDdl({
      namespace: "blog",
      name: "posts",
      columns,
      indexes: [],
      foreignKeys: [
        {
          name: "fk",
          columns: ["a"],
          referencedNamespace: "blog",
          referencedTable: "t",
          referencedColumns: ["id"],
          onDelete: "NO ACTION",
          onUpdate: "NO ACTION",
        },
      ],
      constraints: [],
    });
    expect(ddl).not.toContain("NO ACTION");
  });

  /**
   * `pg_get_indexdef` is exact — including partial and expression indexes,
   * which hand-composition would get wrong.
   */
  it("emits index definitions verbatim and skips the primary key's", () => {
    const ddl = composeDdl({
      namespace: "blog",
      name: "posts",
      columns,
      indexes: [
        { name: "posts_pkey", columns: ["id"], unique: true, primary: true, definition: "IGNORED" },
        {
          name: "ix_partial",
          columns: ["published_at"],
          unique: false,
          primary: false,
          definition:
            "CREATE INDEX ix_partial ON blog.posts USING btree (published_at) WHERE (published_at IS NOT NULL)",
        },
      ],
      foreignKeys: [],
      constraints: [],
    });
    expect(ddl).toContain("WHERE (published_at IS NOT NULL);");
    expect(ddl).not.toContain("IGNORED");
  });

  it("returns empty when there are no columns to describe", () => {
    expect(
      composeDdl({ namespace: "blog", name: "x", columns: [], indexes: [], foreignKeys: [], constraints: [] }),
    ).toBe("");
  });
});
