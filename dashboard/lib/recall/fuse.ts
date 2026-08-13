/**
 * Rank fusion — how the lexical and vector rankings become one ordering.
 *
 * The naive approach is a weighted sum of the two scores. It doesn't work,
 * because BM25 scores are unbounded and corpus-dependent while cosine is
 * bounded to [-1, 1]: `0.5 * bm25 + 0.5 * cosine` is just BM25 with rounding
 * error. Normalising the scores first only moves the problem — min-max
 * normalisation makes the top result's score depend on the *worst* result's.
 *
 * Reciprocal Rank Fusion sidesteps it by throwing the magnitudes away and
 * fusing *positions*. It is the standard answer for exactly this reason and it
 * has one tunable constant.
 */

/**
 * RRF damping. 60 is the value from the original Cormack et al. paper and it
 * is not arbitrary: it controls how quickly rank 1 stops dominating rank 5.
 * Lower makes the fusion winner-takes-all; higher flattens it toward a
 * round-robin merge.
 */
const RRF_K = 60;

export interface RankedList {
  /** Ids in descending relevance. */
  ids: readonly string[];
  /** Relative influence of this list. */
  weight: number;
}

/** Fuse any number of ranked lists into one `id → score` map. */
export function reciprocalRankFusion(lists: readonly RankedList[]): Map<string, number> {
  const fused = new Map<string, number>();
  for (const list of lists) {
    if (list.weight <= 0) continue;
    for (let rank = 0; rank < list.ids.length; rank++) {
      const id = list.ids[rank];
      const contribution = list.weight / (RRF_K + rank + 1);
      fused.set(id, (fused.get(id) ?? 0) + contribution);
    }
  }
  return fused;
}

/**
 * Recency prior with a 90-day half-life.
 *
 * Returns 1.0 for "now" decaying toward 0. Ninety days is chosen against how
 * this vault is actually used: a learning note from six months ago is still
 * true and should still surface, but a terminal failure from six months ago
 * almost certainly refers to code that no longer exists. Half-life rather than
 * a cutoff so nothing ever becomes unreachable — only quieter.
 */
export function recencyScore(ts: number, now = Date.now()): number {
  if (!Number.isFinite(ts) || ts <= 0) return 0;
  const ageDays = Math.max(0, (now - ts) / 86_400_000);
  return Math.pow(0.5, ageDays / 90);
}

/**
 * Boost for chunks that mention an entity the query named.
 *
 * Deliberately strong. If someone types `PTF-3774`, a chunk carrying that exact
 * ticket ref is what they want, and no amount of lexical similarity on the
 * surrounding prose should outrank it. Saturating rather than linear so a
 * chunk citing eight of the query's entities doesn't run away with it.
 */
export function entityScore(chunkRefs: readonly string[], queryRefs: readonly string[]): number {
  if (queryRefs.length === 0 || chunkRefs.length === 0) return 0;
  const wanted = new Set(queryRefs);
  let matches = 0;
  for (const ref of chunkRefs) if (wanted.has(ref)) matches += 1;
  if (matches === 0) return 0;
  return matches / (matches + 1);
}

export interface CombineInput {
  id: string;
  fused: number;
  recency: number;
  entity: number;
}

/**
 * Final score.
 *
 * Fusion carries the relevance signal; recency and entity are *priors* that
 * modulate it rather than compete with it, which is why they're weighted an
 * order of magnitude lower. A chunk with a perfect ticket match but no textual
 * relevance should place well — not first.
 */
export function combineScores(input: CombineInput): number {
  return input.fused + 0.02 * input.recency + 0.05 * input.entity;
}
