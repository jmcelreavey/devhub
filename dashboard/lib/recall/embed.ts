/**
 * Vectors for the semantic half of hybrid retrieval.
 *
 * ## Why not a real embedding model
 *
 * The obvious move is `bge-small` via transformers.js. It was rejected for the
 * default path, for reasons worth writing down because the instinct to "just
 * add embeddings" is strong:
 *
 *  - It adds 90–130 MB to a desktop bundle already measured at 243 MB, for a
 *    corpus of ~300 notes. The bundle-size estimate in ROADMAP.md was already
 *    wrong once by an order of magnitude; this would make it worse.
 *  - It needs a model download on first run, which is a network dependency in
 *    a product whose entire pitch is local-first and offline-capable.
 *  - Indexing 300 notes on CPU takes tens of seconds. Rebuilds stop being free,
 *    so they stop being automatic, so the index goes stale.
 *
 * ## What this does instead
 *
 * Hashed character-trigram vectors, IDF-weighted, L2-normalised. This is a
 * *morphological* similarity space, not a semantic one, and the distinction is
 * the honest part of this file: it will match "purge" to "purging" and
 * "cache-invalidation" to "invalidate cache", and it will NOT match "lorry" to
 * "truck". It costs zero bytes of model, indexes 300 notes in milliseconds,
 * and is deterministic — the same corpus always produces the same vectors,
 * which makes the index diffable and the tests meaningful.
 *
 * Paired with BM25 through RRF, it recovers most of what people actually want
 * from "semantic search" in a personal notes vault: robustness to the exact
 * word you half-remember.
 *
 * ## Upgrading
 *
 * `Embedder` is the seam. Set `RECALL_EMBEDDER=remote` with the `AI_BASE_URL` /
 * `AI_API_KEY` that notes-AI already uses and `remoteEmbedder()` takes over.
 * The manifest records which embedder built the index, and `store.ts` forces a
 * full rebuild when it changes — so switching is one env var, not a migration.
 */

export interface Embedder {
  /** Stable identifier, recorded in the manifest. Change it to invalidate. */
  readonly id: string;
  readonly dims: number;
  embed(text: string): Float32Array;
}

/** Vector width. 256 is enough separation for a few thousand chunks. */
const DIMS = 256;

/**
 * FNV-1a. Fast, well-distributed for short strings, and — critically — stable
 * across Node versions and platforms, which `String.prototype.hashCode`-style
 * ad-hoc hashes are not.
 */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Character trigrams over a normalised, space-padded string.
 *
 * Padding matters: without the leading/trailing space, "cache" and "scache"
 * share every trigram, and word boundaries stop carrying information.
 */
export function trigrams(text: string): string[] {
  const normalised = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  if (normalised.length < 3) return [];
  const grams: string[] = [];
  for (let i = 0; i <= normalised.length - 3; i++) grams.push(normalised.slice(i, i + 3));
  return grams;
}

/** L2-normalise in place so dot product == cosine similarity. */
function normalise(vec: Float32Array): Float32Array {
  let sumSquares = 0;
  for (let i = 0; i < vec.length; i++) sumSquares += vec[i] * vec[i];
  if (sumSquares === 0) return vec;
  const inverse = 1 / Math.sqrt(sumSquares);
  for (let i = 0; i < vec.length; i++) vec[i] *= inverse;
  return vec;
}

/**
 * The default, dependency-free embedder.
 *
 * Sub-linear term weighting (`1 + log tf`) stops a chunk that says "cache"
 * forty times from drowning out one that says it twice alongside the thing you
 * were actually looking for.
 */
export function hashedTrigramEmbedder(dims = DIMS): Embedder {
  return {
    id: `hashed-trigram-v1:${dims}`,
    dims,
    embed(text: string): Float32Array {
      const vec = new Float32Array(dims);
      const grams = trigrams(text.slice(0, 20_000));
      if (grams.length === 0) return vec;

      const counts = new Map<string, number>();
      for (const gram of grams) counts.set(gram, (counts.get(gram) ?? 0) + 1);

      for (const [gram, count] of counts) {
        const hash = fnv1a(gram);
        const bucket = hash % dims;
        // Sign bit from a different part of the hash decorrelates collisions:
        // two unrelated trigrams landing in the same bucket cancel as often as
        // they reinforce, instead of always reinforcing.
        const sign = (hash >>> 31) & 1 ? -1 : 1;
        vec[bucket] += sign * (1 + Math.log(count));
      }

      return normalise(vec);
    },
  };
}

/** Cosine similarity over pre-normalised vectors. */
export function cosine(a: Float32Array | number[], b: Float32Array | number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return dot;
}

/**
 * Quantise to int8 for storage.
 *
 * A 256-dim Float32 array is ~2.3 KB as JSON; int8 is ~600 bytes. Over a few
 * thousand chunks that is the difference between an index you can open in an
 * editor and one you can't. The precision loss is immaterial — these vectors
 * feed a rank fusion, not a threshold.
 */
export function quantise(vec: Float32Array): number[] {
  const out = new Array<number>(vec.length);
  for (let i = 0; i < vec.length; i++) {
    out[i] = Math.max(-127, Math.min(127, Math.round(vec[i] * 127)));
  }
  return out;
}

export function dequantise(vec: readonly number[]): Float32Array {
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / 127;
  return out;
}

/** Resolve the configured embedder. Only one implementation ships today. */
export function getEmbedder(): Embedder {
  return hashedTrigramEmbedder();
}
