/**
 * The derived entity graph.
 *
 * `lib/entity-links/resolve.ts` answers "what does this note link to" by
 * reading `## Links` sections someone typed. This answers "what turns up
 * alongside this thing" by counting co-occurrence across every indexed chunk.
 * The two are complementary and deliberately separate: hand-written links carry
 * intent, co-occurrence carries evidence, and conflating them would let a regex
 * overwrite a human's stated relationship.
 */
import { entityKey } from "@/lib/entity-note";
import { refFromKey } from "./refs";
import type { RecallChunk, RecallEdge, RecallGraph, RecallGraphNode } from "./types";

/**
 * Chunks mentioning more entities than this are skipped for edge-building.
 *
 * A release note listing forty tickets would otherwise emit 780 edges, all of
 * them meaningless — those tickets share a release, not a relationship. The
 * chunk still contributes mentions; it just doesn't get a vote on what relates
 * to what.
 */
const MAX_REFS_PER_CHUNK = 12;

export interface BuildGraphOptions {
  /** Drop edges below this weight. Default 1 (keep everything). */
  minWeight?: number;
  /** Cap on edges returned, highest weight first. */
  maxEdges?: number;
}

export function buildGraph(
  chunks: readonly RecallChunk[],
  options: BuildGraphOptions = {},
): RecallGraph {
  const { minWeight = 1, maxEdges = 500 } = options;

  const nodes = new Map<string, RecallGraphNode>();
  const edges = new Map<string, RecallEdge>();

  for (const chunk of chunks) {
    const refs = [...new Set(chunk.refs)].sort();
    if (refs.length === 0) continue;

    for (const key of refs) {
      const existing = nodes.get(key);
      if (existing) {
        existing.mentions += 1;
        existing.lastSeen = Math.max(existing.lastSeen, chunk.ts);
      } else {
        const ref = refFromKey(key);
        if (!ref) continue;
        nodes.set(key, { key, ref, mentions: 1, lastSeen: chunk.ts });
      }
    }

    if (refs.length > MAX_REFS_PER_CHUNK) continue;

    for (let i = 0; i < refs.length; i++) {
      for (let j = i + 1; j < refs.length; j++) {
        const from = refs[i];
        const to = refs[j];
        if (!nodes.has(from) || !nodes.has(to)) continue;
        const id = `${from}|${to}`;
        const edge = edges.get(id);
        if (edge) {
          edge.weight += 1;
          if (edge.evidence.length < 5) edge.evidence.push(chunk.id);
        } else {
          edges.set(id, { from, to, weight: 1, evidence: [chunk.id] });
        }
      }
    }
  }

  const kept = [...edges.values()]
    .filter((edge) => edge.weight >= minWeight)
    .sort((a, b) => b.weight - a.weight || a.from.localeCompare(b.from))
    .slice(0, maxEdges);

  return {
    nodes: [...nodes.values()].sort((a, b) => b.mentions - a.mentions),
    edges: kept,
  };
}

/** Entities adjacent to `key`, strongest first. */
export function neighbours(
  graph: RecallGraph,
  key: string,
  limit = 12,
): Array<{ node: RecallGraphNode; weight: number; evidence: string[] }> {
  const byKey = new Map(graph.nodes.map((node) => [node.key, node]));
  const out: Array<{ node: RecallGraphNode; weight: number; evidence: string[] }> = [];

  for (const edge of graph.edges) {
    const otherKey = edge.from === key ? edge.to : edge.to === key ? edge.from : null;
    if (!otherKey) continue;
    const node = byKey.get(otherKey);
    if (node) out.push({ node, weight: edge.weight, evidence: edge.evidence });
  }

  return out.sort((a, b) => b.weight - a.weight).slice(0, limit);
}

/**
 * Entities co-occurring with a result set — the "you may also want" list.
 *
 * Weighted by each hit's rank so an entity appearing in the top result counts
 * for more than one buried at position twelve, and normalised out of the
 * query's own entities, which are not a discovery.
 */
export function relatedRefsForHits(
  hits: ReadonlyArray<{ chunk: RecallChunk; score: number }>,
  exclude: readonly string[] = [],
  limit = 8,
): Array<{ ref: NonNullable<ReturnType<typeof refFromKey>>; weight: number }> {
  const excluded = new Set(exclude);
  const weights = new Map<string, number>();

  hits.forEach((hit, rank) => {
    const positional = 1 / (1 + rank);
    for (const key of hit.chunk.refs) {
      if (excluded.has(key)) continue;
      weights.set(key, (weights.get(key) ?? 0) + positional);
    }
  });

  return [...weights.entries()]
    .map(([key, weight]) => ({ ref: refFromKey(key), weight: Math.round(weight * 100) / 100 }))
    .filter((entry): entry is { ref: NonNullable<ReturnType<typeof refFromKey>>; weight: number } =>
      entry.ref !== null,
    )
    .sort((a, b) => b.weight - a.weight || entityKey(a.ref).localeCompare(entityKey(b.ref)))
    .slice(0, limit);
}
