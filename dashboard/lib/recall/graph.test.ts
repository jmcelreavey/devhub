import { describe, expect, it } from "vitest";
import { buildGraph, neighbours, relatedRefsForHits } from "./graph";
import type { RecallChunk } from "./types";

const chunk = (id: string, refs: string[], ts = Date.now()): RecallChunk => ({
  id,
  sourceKind: "note",
  sourceId: id,
  title: id,
  text: id,
  ts,
  refs,
});

describe("buildGraph", () => {
  it("derives an edge from two entities appearing in the same chunk", () => {
    const graph = buildGraph([chunk("a", ["jira:PTF-1", "pr:o/r#2"])]);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].weight).toBe(1);
    // Evidence, not decoration — a derived edge you can't trace is a guess.
    expect(graph.edges[0].evidence).toEqual(["a"]);
  });

  it("accumulates weight across chunks", () => {
    const graph = buildGraph([
      chunk("a", ["jira:PTF-1", "pr:o/r#2"]),
      chunk("b", ["jira:PTF-1", "pr:o/r#2"]),
      chunk("c", ["jira:PTF-1", "repo:devhub"]),
    ]);
    const strongest = graph.edges[0];
    expect(strongest.weight).toBe(2);
    expect([strongest.from, strongest.to]).toContain("pr:o/r#2");
  });

  it("counts mentions even for entities that never pair up", () => {
    const graph = buildGraph([chunk("a", ["jira:PTF-1"]), chunk("b", ["jira:PTF-1"])]);
    expect(graph.edges).toHaveLength(0);
    expect(graph.nodes.find((n) => n.key === "jira:PTF-1")?.mentions).toBe(2);
  });

  it("refuses to build edges from a release-note-shaped chunk", () => {
    // 40 tickets in one chunk share a release, not a relationship — and would
    // otherwise emit 780 meaningless edges.
    const many = Array.from({ length: 40 }, (_, i) => `jira:T-${i}`);
    const graph = buildGraph([chunk("release", many)]);
    expect(graph.edges).toHaveLength(0);
    expect(graph.nodes).toHaveLength(40);
  });

  it("drops unparseable entity keys instead of creating ghost nodes", () => {
    const graph = buildGraph([chunk("a", ["garbage", "jira:PTF-1"])]);
    expect(graph.nodes.map((n) => n.key)).toEqual(["jira:PTF-1"]);
  });

  it("respects minWeight and maxEdges", () => {
    const chunks = [
      chunk("a", ["jira:A", "jira:B"]),
      chunk("b", ["jira:A", "jira:B"]),
      chunk("c", ["jira:C", "jira:D"]),
    ];
    expect(buildGraph(chunks, { minWeight: 2 }).edges).toHaveLength(1);
    expect(buildGraph(chunks, { maxEdges: 1 }).edges).toHaveLength(1);
  });

  it("is order-independent", () => {
    const chunks = [chunk("a", ["jira:B", "jira:A"]), chunk("b", ["jira:A", "jira:B"])];
    const graph = buildGraph(chunks);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].weight).toBe(2);
  });
});

describe("neighbours", () => {
  it("returns the other end of each edge, strongest first", () => {
    const graph = buildGraph([
      chunk("a", ["jira:PTF-1", "pr:o/r#2"]),
      chunk("b", ["jira:PTF-1", "pr:o/r#2"]),
      chunk("c", ["jira:PTF-1", "repo:devhub"]),
    ]);
    const rows = neighbours(graph, "jira:PTF-1");
    expect(rows[0].node.key).toBe("pr:o/r#2");
    expect(rows[0].weight).toBe(2);
    expect(rows).toHaveLength(2);
  });

  it("returns nothing for an unknown entity", () => {
    expect(neighbours(buildGraph([chunk("a", ["jira:A", "jira:B"])]), "jira:ZZZ")).toEqual([]);
  });
});

describe("relatedRefsForHits", () => {
  it("weights entities by the rank of the hit they came from", () => {
    const related = relatedRefsForHits([
      { chunk: chunk("a", ["jira:TOP"]), score: 1 },
      { chunk: chunk("b", ["jira:LOW"]), score: 0.1 },
    ]);
    expect(related[0].ref.id).toBe("TOP");
    expect(related[0].weight).toBeGreaterThan(related[1].weight);
  });

  it("excludes the query's own entities — those aren't a discovery", () => {
    const related = relatedRefsForHits(
      [{ chunk: chunk("a", ["jira:ASKED", "jira:OTHER"]), score: 1 }],
      ["jira:ASKED"],
    );
    expect(related.map((r) => r.ref.id)).toEqual(["OTHER"]);
  });

  it("handles an empty hit list", () => {
    expect(relatedRefsForHits([])).toEqual([]);
  });
});
