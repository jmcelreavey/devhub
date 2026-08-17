/**
 * Recall — the shared shapes for DevHub's derived memory layer.
 *
 * Types only, no runtime imports beyond the EntityRef contract, so client
 * components and the MCP server can both depend on this without dragging
 * `node:fs` into a browser bundle.
 *
 * The mental model:
 *
 *   events (append-only)  ─┐
 *   notes / learnings      ├─→ chunks ─→ index (bm25 + vectors) ─→ recall(query)
 *   docs / tasks          ─┘                   └─→ graph (derived edges)
 *
 * Nothing here is a source of truth. Every chunk points back at a file or an
 * event line that remains canonical and git-tracked; the index is a cache and
 * `rm -rf <notes>/.index` is always safe.
 */
import type { EntityKind, EntityRef } from "@/lib/entity-note";

export type { EntityKind, EntityRef };

/** Where a chunk came from. Drives badges in the UI and filtering in recall(). */
export type RecallSourceKind = "note" | "learning" | "doc" | "task" | "event" | "diagram";

export const RECALL_SOURCE_KINDS: readonly RecallSourceKind[] = [
  "note",
  "learning",
  "doc",
  "task",
  "event",
  "diagram",
] as const;

/**
 * What kind of thing happened. Deliberately coarse — this is a retrieval
 * signal, not an audit schema. `manual` is the escape hatch for anything an
 * agent wants to remember that has no better home.
 */
export type RecallEventKind =
  | "commit"
  | "pr"
  | "ticket"
  | "run"
  | "session"
  | "note"
  | "alert"
  | "decision"
  | "manual";

export const RECALL_EVENT_KINDS: readonly RecallEventKind[] = [
  "commit",
  "pr",
  "ticket",
  "run",
  "session",
  "note",
  "alert",
  "decision",
  "manual",
] as const;

/** One line in the event spine. Immutable once written. */
export interface RecallEvent {
  /** Stable id. Callers may supply their own for idempotent re-emits. */
  id: string;
  /** ISO timestamp. */
  ts: string;
  kind: RecallEventKind;
  title: string;
  /** Optional detail — command output, commit body, failure message. */
  body?: string;
  /** Who/what produced it (`git`, `mcp:claude`, `scripts`, a username). */
  source: string;
  /** Deep link back to the thing itself. */
  url?: string;
  /** Explicit edges. Derived refs are merged on top at index time. */
  refs?: EntityRef[];
  /** Freeform tags — repo name, branch, exit code. */
  meta?: Record<string, string | number | boolean>;
}

/** A retrievable unit of text. Chunks are rebuilt from source; never edited. */
export interface RecallChunk {
  /** `${sourceKind}:${sourceId}#${ordinal}` — stable across rebuilds. */
  id: string;
  sourceKind: RecallSourceKind;
  /** Note path, task id, event id, doc path. */
  sourceId: string;
  title: string;
  text: string;
  /** In-app href for hop-around. */
  href?: string;
  /** Epoch ms — file mtime or event time. Drives the recency prior. */
  ts: number;
  /** `entityKey()` strings (`jira:PTF-3774`, `pr:owner/repo#525`, …). */
  refs: string[];
}

/** A chunk plus the scores that got it into the result set. */
export interface RecallHit {
  chunk: RecallChunk;
  /** Final fused score, higher is better. */
  score: number;
  /** Per-signal contributions, kept so the UI can show *why* something ranked. */
  signals: {
    lexical: number;
    vector: number;
    recency: number;
    entity: number;
  };
  /** Highest-scoring line of the chunk, for previews. */
  snippet: string;
  /** Entity refs on this chunk that the query also mentioned. */
  matchedRefs: string[];
  /** Rough token cost of `chunk.text` (chars / 4). */
  tokens: number;
}

export interface RecallQuery {
  query: string;
  /** Hard cap on hits returned. Default 12. */
  limit?: number;
  /**
   * Token budget for the assembled context. Hits are packed greedily by score
   * until the budget is spent, so a small budget returns fewer, better chunks
   * rather than truncated ones. Default 2000.
   */
  budgetTokens?: number;
  /** Restrict to these source kinds. Default: all. */
  kinds?: RecallSourceKind[];
  /** Only chunks newer than this epoch-ms. */
  since?: number;
  /**
   * 0 = pure lexical, 1 = pure vector. Default 0.5 — hybrid.
   * Exposed because exact-identifier queries (`PTF-3774`) want lexical and
   * "how did we fix the flaky cache thing" wants vector.
   */
  alpha?: number;
}

export interface RecallResult {
  query: string;
  hits: RecallHit[];
  /** Entities the query itself mentioned, after ref extraction. */
  queryRefs: EntityRef[];
  /** Entities that co-occur with the hits — the "you may also want" set. */
  relatedRefs: Array<{ ref: EntityRef; weight: number }>;
  totalTokens: number;
  budgetTokens: number;
  /** Chunks considered before ranking. */
  corpusSize: number;
  /** Chunks that scored above zero but didn't fit the budget. */
  truncated: number;
  /** Chunks dropped as near-identical to one already selected. */
  duplicates: number;
  indexBuiltAt: string | null;
  tookMs: number;
}

export interface RecallIndexManifest {
  version: number;
  builtAt: string;
  chunkCount: number;
  /** Chunk counts by source kind, for the status panel. */
  bySource: Record<string, number>;
  /** Vector dimensionality. */
  dims: number;
  /** Which embedder produced the vectors; a change forces a full rebuild. */
  embedder: string;
  tookMs: number;
}

/** One derived edge between two entities, with the chunks that justify it. */
export interface RecallEdge {
  from: string;
  to: string;
  weight: number;
  /** Chunk ids that mention both ends. Evidence, not decoration. */
  evidence: string[];
}

export interface RecallGraphNode {
  key: string;
  ref: EntityRef;
  /** Number of chunks mentioning this entity. */
  mentions: number;
  lastSeen: number;
}

export interface RecallGraph {
  nodes: RecallGraphNode[];
  edges: RecallEdge[];
}
