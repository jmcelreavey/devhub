import { describe, expect, it } from "vitest";
import {
  csvCell,
  exportFilename,
  exportResultSet,
  sqlLiteral,
  toCsv,
  toJson,
  toSqlInserts,
} from "./export";
import type { DbResultSet } from "./types";

const result: DbResultSet = {
  columns: [{ name: "id" }, { name: "name" }, { name: "note" }],
  rows: [
    [1, "ada", null],
    [2, "grace, admiral", 'said "hopper"'],
  ],
  truncated: false,
  durationMs: 1,
  statement: "SELECT * FROM users",
};

describe("csvCell", () => {
  it("leaves plain values unquoted", () => {
    expect(csvCell("ada")).toBe("ada");
    expect(csvCell(42)).toBe("42");
  });

  it("renders null as empty", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("quotes separators, quotes and newlines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  /**
   * A cell starting with = + - or @ executes as a formula when the file is
   * opened in Excel or Sheets, and a column of user-supplied text is a very
   * plausible source of one.
   */
  it("defuses formula injection", () => {
    expect(csvCell("=cmd|'/c calc'!A1")).toBe(`"\t=cmd|'/c calc'!A1"`);
    expect(csvCell("+1234")).toBe('"\t+1234"');
    expect(csvCell("-1")).toBe('"\t-1"');
    expect(csvCell("@SUM(A1)")).toBe('"\t@SUM(A1)"');
  });
});

describe("toCsv", () => {
  it("writes a header and one line per row", () => {
    expect(toCsv(result).split("\n")).toEqual([
      "id,name,note",
      "1,ada,",
      '2,"grace, admiral","said ""hopper"""',
    ]);
  });
});

describe("toJson", () => {
  it("emits row objects keyed by column name", () => {
    expect(JSON.parse(toJson(result))).toEqual([
      { id: 1, name: "ada", note: null },
      { id: 2, name: "grace, admiral", note: 'said "hopper"' },
    ]);
  });
});

describe("sqlLiteral", () => {
  it("renders each type correctly", () => {
    expect(sqlLiteral(null)).toBe("NULL");
    expect(sqlLiteral(7)).toBe("7");
    expect(sqlLiteral(true)).toBe("TRUE");
    expect(sqlLiteral("ada")).toBe("'ada'");
  });

  it("escapes embedded quotes", () => {
    expect(sqlLiteral("O'Hara")).toBe("'O''Hara'");
  });

  it("does not emit Infinity or NaN as a bare literal", () => {
    expect(sqlLiteral(Infinity)).toBe("NULL");
    expect(sqlLiteral(NaN)).toBe("NULL");
  });
});

describe("toSqlInserts", () => {
  it("writes one INSERT per row with quoted identifiers", () => {
    expect(toSqlInserts(result, "users").split("\n")).toEqual([
      `INSERT INTO "users" ("id", "name", "note") VALUES (1, 'ada', NULL);`,
      `INSERT INTO "users" ("id", "name", "note") VALUES (2, 'grace, admiral', 'said "hopper"');`,
    ]);
  });

  it("returns empty for a result with no columns", () => {
    expect(toSqlInserts({ ...result, columns: [], rows: [] })).toBe("");
  });
});

describe("exportResultSet", () => {
  it("dispatches by format", () => {
    expect(exportResultSet(result, "csv")).toContain("id,name,note");
    expect(exportResultSet(result, "json")).toContain('"name": "ada"');
    expect(exportResultSet(result, "sql", "t")).toContain('INSERT INTO "t"');
  });
});

describe("exportFilename", () => {
  it("dates the filename and keeps it filesystem-safe", () => {
    expect(exportFilename("public.posts", "csv", new Date("2026-08-28T12:00:00Z"))).toBe(
      "public.posts-2026-08-28.csv",
    );
    expect(exportFilename("weird / name!", "json", new Date("2026-08-28T12:00:00Z"))).toBe(
      "weird-name-2026-08-28.json",
    );
  });

  it("falls back when the name has nothing usable in it", () => {
    expect(exportFilename("///", "csv", new Date("2026-08-28T12:00:00Z"))).toBe(
      "export-2026-08-28.csv",
    );
  });
});
