/**
 * One tokenizer for the whole recall layer.
 *
 * `shared/notes-search/lexical.ts` has its own, deliberately left alone: that
 * one backs the existing /api/search contract and changing its tokenisation
 * would silently reorder results people are used to. This one is free to be
 * stricter (light stemming, identifier splitting) because nothing depends on
 * its output ordering yet.
 */

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "in", "on", "at", "to", "for", "of", "is", "are",
  "was", "were", "be", "been", "being", "it", "its", "this", "that", "these", "those", "with",
  "as", "by", "from", "we", "i", "you", "he", "she", "they", "them", "our", "your", "their",
  "do", "does", "did", "have", "has", "had", "can", "could", "should", "would", "will", "just",
  "not", "no", "so", "than", "then", "there", "here", "when", "what", "which", "who", "how",
  "into", "about", "over", "after", "before", "up", "down", "out", "own", "same", "too", "very",
]);

/**
 * Dropping a trailing `e` after suffix removal.
 *
 * This is the step that makes the suffix list actually work. Without it
 * `purge` stems to `purge` while `purging` stems to `purg`, so the two never
 * match and the whole exercise buys nothing. Applying it unconditionally —
 * not just after a strip — is what keeps the base form and the inflected form
 * landing on the same token.
 */
function trimTrailingE(token: string): string {
  return token.length > 3 && token.endsWith("e") ? token.slice(0, -1) : token;
}

/**
 * Light suffix stripping. Not a real stemmer — a real one (Porter) is ~200
 * lines of rules for a corpus of 300 notes, and its aggressive stem collisions
 * ("organisation" → "organ") hurt more than the recall they buy here.
 *
 * These four suffixes cover what actually bites in a dev notes vault:
 * purge/purges/purged/purging and cache/caches all collapse to one token.
 * Derivational morphology (deploy/deployment) is deliberately *not* covered —
 * that is the vector side's job, and trying to do it with suffix rules is
 * where naive stemmers start destroying precision.
 */
function stem(token: string): string {
  if (token.length <= 3) return token;
  for (const suffix of ["ing", "ed", "es", "s"]) {
    // The `>= 3` floor stops `used` → `us` and similar, where the remainder is
    // too short to still mean anything.
    if (token.endsWith(suffix) && token.length - suffix.length >= 3) {
      return trimTrailingE(token.slice(0, token.length - suffix.length));
    }
  }
  return trimTrailingE(token);
}

/**
 * Split identifiers so `getUserById` and `cache_purge_handler` are findable by
 * their parts. The original token is kept too — searching the exact identifier
 * should still rank it first.
 */
function splitIdentifier(raw: string): string[] {
  const parts = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  return parts.length > 1 ? parts : [];
}

export interface TokenizeOptions {
  /** Keep stop words (used when tokenising short titles where "how to" matters). */
  keepStopWords?: boolean;
  /** Skip stemming — used for exact-identifier matching. */
  raw?: boolean;
}

export function tokenize(text: string, options: TokenizeOptions = {}): string[] {
  const { keepStopWords = false, raw = false } = options;
  const out: string[] = [];

  for (const match of text.matchAll(/[A-Za-z0-9][A-Za-z0-9_-]*/g)) {
    const word = match[0];
    const candidates = [word, ...splitIdentifier(word)];
    for (const candidate of candidates) {
      const lower = candidate.toLowerCase();
      if (lower.length < 2) continue;
      if (!keepStopWords && STOP_WORDS.has(lower)) continue;
      out.push(raw ? lower : stem(lower));
    }
  }

  return out;
}

/** Term frequency map. */
export function termFrequency(tokens: readonly string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
  return tf;
}

/** Cheap token estimate — chars/4, the usual rule of thumb. Never returns 0. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
