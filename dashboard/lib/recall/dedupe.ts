/**
 * Near-duplicate detection for result sets.
 *
 * ## Why this exists
 *
 * Found by running recall against the real vault, which is the only way it
 * *could* have been found. A query for a ticket key returned five hits that
 * were all the same rolled-over task — "Address BI Jobs Feedback [PTF-4484]" —
 * on five consecutive dates. The per-source cap in `recall()` cannot see it:
 * rollover writes each day to its own `tasks/YYYY-MM-DD.json`, so the index is
 * correct in reporting five distinct sources. They just say the same thing.
 *
 * ## Why not cosine
 *
 * The first attempt compared the vectors already in memory, which was appealing
 * because it was free. It doesn't work on short chunks: in a 60-character task
 * line the date is ~15% of the text, so two consecutive days score around 0.85
 * — under any threshold that doesn't also start suppressing genuinely different
 * notes on a shared topic, which sit at 0.6–0.8. There is no threshold that
 * separates them because the signal isn't magnitude, it's *which* tokens differ.
 *
 * ## What it does instead
 *
 * Jaccard over non-numeric vocabulary, gated on identical entity refs.
 *
 * Dropping numbers is the whole trick: dates, counts and ids are precisely the
 * volatile part of otherwise-identical text, so removing them makes a rolled
 * task compare at 1.0 against itself while leaving prose comparisons untouched.
 *
 * The ref equality gate is what stops that from over-reaching. Two chunks
 * reading "Address BI Jobs Feedback" under *different* tickets have identical
 * non-numeric vocabulary but different refs, and they are not duplicates —
 * they're two tickets that happen to be described the same way, and
 * suppressing one would hide real information.
 */
import { tokenize } from "./tokenize";

/**
 * Vocabulary overlap above which two chunks are the same content.
 *
 * High on purpose. With numbers already removed, real duplicates sit at or
 * near 1.0, so anything below ~0.9 is buying nothing and risking a false
 * positive.
 */
const JACCARD_THRESHOLD = 0.9;

/** Chunks shorter than this are compared but never *cause* a suppression. */
const MIN_TOKENS = 3;

export interface DedupeSignature {
  /** Non-numeric stemmed vocabulary. */
  vocab: Set<string>;
  /** Sorted entity keys, joined — cheap equality check. */
  refKey: string;
}

/** Build the comparable signature for a chunk. */
export function dedupeSignature(text: string, refs: readonly string[]): DedupeSignature {
  const vocab = new Set<string>();
  for (const token of tokenize(text)) {
    // "No letters at all" rather than "^\d+$", because the tokenizer keeps
    // hyphenated forms whole: a date arrives as the single token `2026-07-30`,
    // which `^\d+$` does not match, and leaving it in was enough on its own to
    // drop two consecutive days of the same task from 1.0 to 0.8 similarity.
    //
    // Still not "contains a digit" — that would discard `s3`, `oauth2` and
    // `ptf-4484`, which are exactly the technical vocabulary that tells two
    // chunks apart.
    if (!/[a-z]/.test(token)) continue;
    vocab.add(token);
  }
  return { vocab, refKey: [...refs].sort().join("|") };
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const token of small) if (large.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

/**
 * True when `candidate` says the same thing as `existing`.
 *
 * Both conditions are required. Vocabulary alone over-reaches onto distinct
 * entities described identically; ref equality alone would collapse every
 * chunk of a long note about one ticket.
 */
export function isNearDuplicate(candidate: DedupeSignature, existing: DedupeSignature): boolean {
  if (candidate.refKey !== existing.refKey) return false;
  if (candidate.vocab.size < MIN_TOKENS || existing.vocab.size < MIN_TOKENS) return false;
  return jaccard(candidate.vocab, existing.vocab) >= JACCARD_THRESHOLD;
}
