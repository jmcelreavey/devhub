import { describe, expect, it } from "vitest";
import {
  classifyMongoCommand,
  MongoCommandError,
  parseMongoCommand,
  parseRelaxedJson,
  pipelineWritesOutput,
  splitArguments,
} from "./command";

describe("parseRelaxedJson", () => {
  it("parses strict JSON", () => {
    expect(parseRelaxedJson('{"a":1}')).toEqual({ a: 1 });
  });

  /** People paste from mongosh, logs and Slack; none of those are strict JSON. */
  it("accepts single quotes, unquoted keys and trailing commas", () => {
    expect(parseRelaxedJson("{ status: 'published', }")).toEqual({ status: "published" });
    expect(parseRelaxedJson("{ a: 1, b: [1, 2,], }")).toEqual({ a: 1, b: [1, 2] });
  });

  it("keeps punctuation inside strings intact", () => {
    expect(parseRelaxedJson(`{ title: "a: b, c" }`)).toEqual({ title: "a: b, c" });
  });

  it("converts ObjectId and date helpers into extended-JSON tags", () => {
    expect(parseRelaxedJson('{ _id: ObjectId("507f1f77bcf86cd799439011") }')).toEqual({
      _id: { $oid: "507f1f77bcf86cd799439011" },
    });
    expect(parseRelaxedJson('{ at: ISODate("2026-01-01T00:00:00Z") }')).toEqual({
      at: { $date: "2026-01-01T00:00:00Z" },
    });
  });

  it("refuses what it cannot parse rather than guessing", () => {
    expect(() => parseRelaxedJson("{ a: someFunction() }")).toThrow(MongoCommandError);
  });
});

describe("splitArguments", () => {
  it("splits on top-level commas only", () => {
    expect(splitArguments('{ a: 1, b: 2 }, { _id: 0 }')).toEqual(["{ a: 1, b: 2 }", "{ _id: 0 }"]);
  });

  it("ignores commas inside strings", () => {
    expect(splitArguments('{ t: "a,b" }')).toEqual(['{ t: "a,b" }']);
  });

  it("handles nested arrays and objects", () => {
    expect(splitArguments("[{ $match: { a: 1 } }, { $limit: 2 }]")).toEqual([
      "[{ $match: { a: 1 } }, { $limit: 2 }]",
    ]);
  });
});

describe("parseMongoCommand — shell shorthand", () => {
  it("parses a find with a filter", () => {
    expect(parseMongoCommand('db.posts.find({ status: "published" })')).toEqual({
      collection: "posts",
      operation: "find",
      filter: { status: "published" },
    });
  });

  it("parses a find with a projection", () => {
    const cmd = parseMongoCommand("db.posts.find({ a: 1 }, { _id: 0, title: 1 })");
    expect(cmd.projection).toEqual({ _id: 0, title: 1 });
  });

  it("parses chained limit, skip and sort", () => {
    const cmd = parseMongoCommand("db.posts.find({}).sort({ createdAt: -1 }).limit(10).skip(5)");
    expect(cmd.sort).toEqual({ createdAt: -1 });
    expect(cmd.limit).toBe(10);
    expect(cmd.skip).toBe(5);
  });

  it("parses an aggregate pipeline", () => {
    const cmd = parseMongoCommand("db.posts.aggregate([{ $match: { a: 1 } }, { $count: 'n' }])");
    expect(cmd.pipeline).toEqual([{ $match: { a: 1 } }, { $count: "n" }]);
  });

  it("parses bracket collection access for awkward names", () => {
    expect(parseMongoCommand('db["my-collection"].find({})').collection).toBe("my-collection");
  });

  it("parses distinct", () => {
    const cmd = parseMongoCommand('db.posts.distinct("author", { status: "published" })');
    expect(cmd.field).toBe("author");
    expect(cmd.filter).toEqual({ status: "published" });
  });

  it("maps updateOne's positional arguments", () => {
    const cmd = parseMongoCommand('db.posts.updateOne({ _id: 1 }, { $set: { title: "x" } })');
    expect(cmd.filter).toEqual({ _id: 1 });
    expect(cmd.update).toEqual({ $set: { title: "x" } });
  });

  it("wraps insertOne into a documents array", () => {
    expect(parseMongoCommand("db.posts.insertOne({ a: 1 })").documents).toEqual([{ a: 1 }]);
  });

  it("tolerates a trailing semicolon", () => {
    expect(parseMongoCommand("db.posts.find({});").operation).toBe("find");
  });

  it("rejects an unsupported operation", () => {
    expect(() => parseMongoCommand("db.posts.mapReduce({})")).toThrow(/Unsupported operation/);
  });

  it("rejects unbalanced parentheses", () => {
    expect(() => parseMongoCommand("db.posts.find({ a: 1 }")).toThrow(/Unbalanced/);
  });

  it("rejects text that is neither form", () => {
    expect(() => parseMongoCommand("SELECT * FROM posts")).toThrow(/Expected db\./);
  });
});

describe("parseMongoCommand — JSON document", () => {
  it("parses the canonical form", () => {
    const cmd = parseMongoCommand('{"collection":"posts","operation":"find","filter":{"a":1}}');
    expect(cmd).toMatchObject({ collection: "posts", operation: "find", filter: { a: 1 } });
  });

  it("requires a collection", () => {
    expect(() => parseMongoCommand('{"operation":"find"}')).toThrow(/needs a "collection"/);
  });

  it("rejects an unknown operation", () => {
    expect(() => parseMongoCommand('{"collection":"p","operation":"nuke"}')).toThrow(
      /Unknown operation/,
    );
  });
});

describe("pipelineWritesOutput", () => {
  /**
   * The trap: an aggregate reads right up until its last stage writes a whole
   * collection.
   */
  it("finds $out and $merge at the top level", () => {
    expect(pipelineWritesOutput([{ $match: {} }, { $out: "copy" }])).toBe("$out");
    expect(pipelineWritesOutput([{ $merge: { into: "copy" } }])).toBe("$merge");
  });

  it("finds them nested inside $facet or $unionWith", () => {
    expect(pipelineWritesOutput([{ $facet: { a: [{ $out: "copy" }] } }])).toBe("$out");
  });

  it("returns null for a read-only pipeline", () => {
    expect(pipelineWritesOutput([{ $match: { a: 1 } }, { $group: { _id: "$a" } }])).toBeNull();
  });
});

describe("classifyMongoCommand", () => {
  it("classifies reads, writes and DDL", () => {
    expect(classifyMongoCommand(parseMongoCommand("db.p.find({})")).kind).toBe("read");
    expect(classifyMongoCommand(parseMongoCommand("db.p.deleteMany({})")).kind).toBe("write");
    expect(classifyMongoCommand(parseMongoCommand('db.p.dropIndex("ix")')).kind).toBe("ddl");
  });

  it("reclassifies an aggregate that writes its output", () => {
    const result = classifyMongoCommand(parseMongoCommand("db.p.aggregate([{ $out: 'copy' }])"));
    expect(result.kind).toBe("write");
    expect(result.reason).toMatch(/\$out/);
  });

  it("leaves an ordinary aggregate as a read", () => {
    expect(classifyMongoCommand(parseMongoCommand("db.p.aggregate([{ $match: {} }])")).kind).toBe(
      "read",
    );
  });
});
