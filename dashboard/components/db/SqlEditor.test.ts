import { describe, expect, it } from "vitest";
import { toCompletionSchema } from "./SqlEditor";

describe("toCompletionSchema", () => {
  it("registers a table under both its qualified and bare name", () => {
    expect(toCompletionSchema({ "blog.posts": ["id", "title"] }, "blog")).toEqual({
      "blog.posts": ["id", "title"],
      posts: ["id", "title"],
    });
  });

  it("keeps each table's own columns", () => {
    const schema = toCompletionSchema(
      { "blog.posts": ["id", "title"], "blog.authors": ["id", "email"] },
      "blog",
    );
    expect(schema["blog.posts"]).toEqual(["id", "title"]);
    expect(schema.authors).toEqual(["id", "email"]);
  });

  /**
   * Two schemas can both have `posts`. Silently completing the wrong one's
   * columns is worse than completing none — you would not notice until the
   * query failed, or worse, didn't.
   */
  it("gives a contested bare name to the default schema", () => {
    const schema = toCompletionSchema(
      { "archive.posts": ["old_id"], "blog.posts": ["id", "title"] },
      "blog",
    );
    expect(schema.posts).toEqual(["id", "title"]);
    // Both remain reachable when qualified.
    expect(schema["archive.posts"]).toEqual(["old_id"]);
    expect(schema["blog.posts"]).toEqual(["id", "title"]);
  });

  it("resolves a contested bare name deterministically with no default schema", () => {
    const schema = toCompletionSchema({ "b.posts": ["from_b"], "a.posts": ["from_a"] });
    // Alphabetical, so the same input always produces the same completion.
    expect(schema.posts).toEqual(["from_a"]);
  });

  it("handles a table with no columns", () => {
    expect(toCompletionSchema({ "main.things": [] }, "main")).toEqual({
      "main.things": [],
      things: [],
    });
  });

  it("handles an awkward table name", () => {
    const schema = toCompletionSchema({ 'main.we"ird': ["select", "col with space"] }, "main");
    expect(schema['we"ird']).toEqual(["select", "col with space"]);
  });

  it("returns an empty map for an empty source", () => {
    expect(toCompletionSchema({})).toEqual({});
  });
});
