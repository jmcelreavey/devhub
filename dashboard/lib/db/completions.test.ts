import { describe, expect, it } from "vitest";
import { groupCompletionRows } from "./completions";

describe("groupCompletionRows", () => {
  it("groups columns under their qualified table", () => {
    expect(
      groupCompletionRows([
        { schema: "blog", table: "posts", column: "id" },
        { schema: "blog", table: "posts", column: "title" },
        { schema: "blog", table: "authors", column: "id" },
      ]),
    ).toEqual({
      "blog.posts": ["id", "title"],
      "blog.authors": ["id"],
    });
  });

  /** Column order is the table's own, so completions read like the table does. */
  it("preserves the order rows arrive in", () => {
    expect(
      groupCompletionRows([
        { schema: "s", table: "t", column: "z" },
        { schema: "s", table: "t", column: "a" },
      ])["s.t"],
    ).toEqual(["z", "a"]);
  });

  it("keeps same-named tables in different schemas apart", () => {
    const grouped = groupCompletionRows([
      { schema: "blog", table: "posts", column: "id" },
      { schema: "archive", table: "posts", column: "old_id" },
    ]);
    expect(grouped["blog.posts"]).toEqual(["id"]);
    expect(grouped["archive.posts"]).toEqual(["old_id"]);
  });

  it("returns an empty map for no rows", () => {
    expect(groupCompletionRows([])).toEqual({});
  });
});
