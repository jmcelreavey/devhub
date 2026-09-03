import { describe, expect, it } from "vitest";
import {
  classifySqlBatch,
  classifySqlStatement,
  firstNonReadStatement,
  splitSqlStatements,
} from "./statement-kind";

const kindOf = (sql: string) => classifySqlStatement(sql).kind;

describe("splitSqlStatements", () => {
  it("splits on top-level semicolons", () => {
    expect(splitSqlStatements("SELECT 1; SELECT 2").map((s) => s.sql)).toEqual([
      "SELECT 1",
      "SELECT 2",
    ]);
  });

  it("ignores semicolons inside string literals", () => {
    const parts = splitSqlStatements("SELECT 'a;b' AS x; SELECT 2");
    expect(parts.map((s) => s.sql)).toEqual(["SELECT 'a;b' AS x", "SELECT 2"]);
  });

  it("ignores semicolons inside dollar-quoted bodies", () => {
    const sql = "CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END $$ LANGUAGE plpgsql";
    expect(splitSqlStatements(sql)).toHaveLength(1);
  });

  it("ignores semicolons inside comments", () => {
    expect(splitSqlStatements("SELECT 1 -- ; not a split\n; SELECT 2").map((s) => s.sql)).toEqual([
      "SELECT 1 -- ; not a split",
      "SELECT 2",
    ]);
  });

  it("handles nested block comments", () => {
    expect(splitSqlStatements("/* outer /* inner ; */ still */ SELECT 1").map((s) => s.sql)).toEqual([
      "/* outer /* inner ; */ still */ SELECT 1",
    ]);
  });

  it("drops comment-only and empty fragments", () => {
    expect(splitSqlStatements("-- just a note\n;;  ;")).toEqual([]);
  });

  /** The editor highlights the offending statement using these offsets. */
  it("reports offsets into the original text", () => {
    const sql = "SELECT 1;\n  DELETE FROM t";
    const [, second] = splitSqlStatements(sql);
    expect(sql.slice(second.start, second.end)).toBe("DELETE FROM t");
  });
});

describe("classifySqlStatement", () => {
  it("classifies plain reads", () => {
    expect(kindOf("SELECT * FROM users")).toBe("read");
    expect(kindOf("select 1")).toBe("read");
    expect(kindOf("TABLE users")).toBe("read");
    expect(kindOf("VALUES (1), (2)")).toBe("read");
    expect(kindOf("SHOW search_path")).toBe("read");
  });

  it("classifies plain writes and DDL", () => {
    expect(kindOf("INSERT INTO t VALUES (1)")).toBe("write");
    expect(kindOf("UPDATE t SET a = 1")).toBe("write");
    expect(kindOf("DELETE FROM t")).toBe("write");
    expect(kindOf("MERGE INTO t USING s ON true")).toBe("write");
    expect(kindOf("CREATE TABLE t (a int)")).toBe("ddl");
    expect(kindOf("ALTER TABLE t ADD COLUMN b int")).toBe("ddl");
    expect(kindOf("DROP TABLE t")).toBe("ddl");
    expect(kindOf("TRUNCATE t")).toBe("ddl");
  });

  /**
   * The case a naive "starts with SELECT" check gets wrong, and the reason this
   * module tokenises at all.
   */
  it("sees a mutation hiding in a CTE", () => {
    expect(kindOf("WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d")).toBe("write");
    expect(kindOf("WITH i AS (INSERT INTO t VALUES (1) RETURNING *) SELECT * FROM i")).toBe("write");
  });

  it("treats a read-only CTE as a read", () => {
    expect(kindOf("WITH recent AS (SELECT * FROM t LIMIT 10) SELECT count(*) FROM recent")).toBe(
      "read",
    );
  });

  it("treats SELECT … INTO as DDL", () => {
    expect(kindOf("SELECT * INTO archive FROM t")).toBe("ddl");
  });

  it("treats row-locking selects as writes", () => {
    expect(kindOf("SELECT * FROM t FOR UPDATE")).toBe("write");
    expect(kindOf("SELECT * FROM t FOR NO KEY UPDATE")).toBe("write");
    expect(kindOf("SELECT * FROM t FOR SHARE")).toBe("write");
  });

  it("does not mistake a FOR in an ordinary select for a lock", () => {
    expect(kindOf("SELECT a FROM t WHERE label = 'for update'")).toBe("read");
  });

  /** EXPLAIN ANALYZE really runs the statement — this is the trap. */
  it("classifies EXPLAIN by whether it executes", () => {
    expect(kindOf("EXPLAIN SELECT * FROM t")).toBe("read");
    expect(kindOf("EXPLAIN DELETE FROM t")).toBe("read");
    expect(kindOf("EXPLAIN ANALYZE SELECT * FROM t")).toBe("read");
    expect(kindOf("EXPLAIN ANALYZE DELETE FROM t")).toBe("write");
    expect(kindOf("EXPLAIN (ANALYZE, BUFFERS) UPDATE t SET a = 1")).toBe("write");
  });

  it("splits COPY by direction", () => {
    expect(kindOf("COPY t TO STDOUT")).toBe("read");
    expect(kindOf("COPY t FROM '/tmp/x.csv'")).toBe("write");
    expect(kindOf("COPY t TO '/tmp/x.csv'")).toBe("unknown");
  });

  it("refuses statements it cannot reason about", () => {
    expect(kindOf("DO $$ BEGIN PERFORM 1; END $$")).toBe("unknown");
    expect(kindOf("CALL do_something()")).toBe("unknown");
    expect(kindOf("SET ROLE postgres")).toBe("unknown");
    expect(kindOf("VACUUM FULL t")).toBe("ddl");
  });

  it("refuses hand-written transaction control", () => {
    const { kind, reason } = classifySqlStatement("BEGIN");
    expect(kind).toBe("unknown");
    expect(reason).toMatch(/DevHub manages the transaction/);
  });

  it("fails closed on anything unrecognised", () => {
    expect(kindOf("FLUMMOX THE DATABASE")).toBe("unknown");
  });

  /**
   * A column named "delete" is legal and quoted. Reading it as the keyword
   * would refuse a perfectly ordinary read.
   */
  it("does not read quoted identifiers as keywords", () => {
    expect(kindOf('SELECT "delete", "update" FROM audit')).toBe("read");
  });

  it("does not read string contents as keywords", () => {
    expect(kindOf("SELECT * FROM t WHERE action = 'DELETE FROM users'")).toBe("read");
  });

  it("ignores leading comments", () => {
    expect(kindOf("-- explain the query\nSELECT 1")).toBe("read");
    expect(kindOf("/* header */ DELETE FROM t")).toBe("write");
  });
});

describe("classifySqlBatch", () => {
  it("takes the strongest kind in the batch", () => {
    expect(classifySqlBatch("SELECT 1; SELECT 2").kind).toBe("read");
    expect(classifySqlBatch("SELECT 1; UPDATE t SET a = 1").kind).toBe("write");
    expect(classifySqlBatch("UPDATE t SET a = 1; DROP TABLE t").kind).toBe("ddl");
    expect(classifySqlBatch("SELECT 1; FLUMMOX").kind).toBe("unknown");
  });

  it("names the statement that would be refused", () => {
    const batch = classifySqlBatch("SELECT 1;\nDELETE FROM t");
    expect(firstNonReadStatement(batch)?.sql).toBe("DELETE FROM t");
  });

  it("returns null when every statement is a read", () => {
    expect(firstNonReadStatement(classifySqlBatch("SELECT 1; SELECT 2"))).toBeNull();
  });

  it("treats an empty batch as a read with no statements", () => {
    const batch = classifySqlBatch("   \n-- nothing\n");
    expect(batch.statements).toEqual([]);
    expect(batch.kind).toBe("read");
  });
});
