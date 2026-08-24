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

describe("graphGridTemplate", () => {
  it("emits all tracks when everything is on", () => {
    const t = graphGridTemplate(DEFAULT_GRAPH_COLUMNS);
    // hash | subject | refs | author | date | kebab
    expect(t.split(" ").length).toBeGreaterThanOrEqual(6);
    expect(t.startsWith("3.8rem")).toBe(true);
    expect(t).toContain("minmax(0, 1fr)");
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
    const t = graphGridTemplate({ hash: true, refs: false, author: true, date: false });
    const tracks = t.split(" ");
    expect(tracks[0]).toBe("3.8rem");
    expect(tracks[1]).toBe("minmax(0, 1fr)");
    expect(tracks[2]).toContain("7rem");
  });
});
