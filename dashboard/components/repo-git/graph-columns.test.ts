import { describe, expect, it } from "vitest";
import {
  DEFAULT_GRAPH_COLUMNS,
  graphGridTemplate,
  resolveColumns,
} from "./CommitGraph";

describe("resolveColumns", () => {
  it("defaults to every column", () => {
    expect(resolveColumns()).toEqual(DEFAULT_GRAPH_COLUMNS);
    expect(resolveColumns({})).toEqual(DEFAULT_GRAPH_COLUMNS);
  });

  it("merges partial overrides over the defaults", () => {
    expect(resolveColumns({ author: false })).toEqual({
      hash: true,
      refs: true,
      author: false,
      date: true,
    });
    // An explicitly false entry must not be "filled in" back to true.
    const cols = resolveColumns({ hash: false, refs: false });
    expect(cols.hash).toBe(false);
    expect(cols.refs).toBe(false);
  });
});

/**
 * Track order is the contract, so these assert on the whole template.
 *
 * Splitting on spaces looks natural and is wrong: `minmax(0, 1fr)` contains
 * one, so `split(" ")[1]` is the string `"minmax(0,"`. These tests were never
 * collected by the vitest include globs, so that mistake sat here unnoticed —
 * comparing the full string is both correct and a stronger assertion.
 */
describe("graphGridTemplate", () => {
  it("emits all tracks when everything is on", () => {
    // hash | subject | refs | author | date | kebab
    expect(graphGridTemplate(DEFAULT_GRAPH_COLUMNS)).toBe(
      "3.8rem minmax(0, 1fr) minmax(0, 30%) minmax(7rem, 12rem) 5.5rem 24px",
    );
  });

  it("drops tracks for hidden columns; subject and kebab always remain", () => {
    const t = graphGridTemplate({
      hash: false,
      refs: false,
      author: false,
      date: false,
    });
    expect(t).toBe("minmax(0, 1fr) 24px");
  });

  it("keeps subject first after an optional hash", () => {
    expect(graphGridTemplate({ hash: true, refs: false, author: true, date: false })).toBe(
      "3.8rem minmax(0, 1fr) minmax(7rem, 12rem) 24px",
    );
  });
});
