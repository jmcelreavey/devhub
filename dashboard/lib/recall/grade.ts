/**
 * Does the retrieved evidence actually answer the question?
 *
 * ## The gap this closes
 *
 * `recall()` is a ranker. Ranking is relative — it returns the best twelve
 * chunks in the vault whether or not any of them are any good. Ask it about
 * something you have never written a note about and you still get twelve
 * confident-looking citations, because "best available" and "good enough" are
 * different claims and nothing in the pipeline distinguished them.
 *
 * That matters most where recall is consumed by an agent rather than a human.
 * A person scanning twelve snippets notices when none are relevant; a model
 * handed the same twelve as "context" will cheerfully build an answer on them.
 * The cheapest hallucination to prevent is the one where the retrieval layer
 * said "here is what I know" when the honest answer was "nothing".
 *
 * ## Deterministic, not a model call
 *
 * This grades with the signals the ranker already computed, and does not ask an
 * LLM whether the results are relevant. That follows `embed.ts`: the vault is
 * local-first, the index is deterministic and diffable, and a grader that needs
 * the network would make `recall` fail differently depending on whether the
 * user was online. A rubric over existing signals is weaker than a model, but
 * it is free, instant, testable, and — most importantly — it is *stable*, so a
 * refusal today is a refusal tomorrow.
 *
 * ## Why a verdict and not a threshold
 *
 * The obvious version drops hits below some score. That is worse than useless:
 * scores are fused ranks, so the absolute value drifts with corpus size, and a
 * hard cutoff silently deletes the only weak-but-real evidence in the vault.
 * Grading instead *labels* the result and leaves every hit in place. Callers
 * that want to refuse can refuse; callers that want to show weak evidence
 * clearly marked can do that instead. Nothing is thrown away on the grader's
 * say-so.
 */
import type { RecallResult } from "./types";
import { tokenize } from "./tokenize";

export type RecallVerdict =
  /** Evidence overlaps the question and is worth answering from. */
  | "answerable"
  /** Something came back, but the overlap is thin — cite, don't conclude. */
  | "weak"
  /** Nothing usable. The honest answer is "the vault doesn't have this". */
  | "no-evidence";

export interface RecallGrade {
  verdict: RecallVerdict;
  /** Share of query terms that appear anywhere in the returned hits, 0–1. */
  termCoverage: number;
  /** Hits containing at least one query term. */
  supportingHits: number;
  /** Entity refs the query named that the hits actually carry. */
  matchedRefs: string[];
  /** One line, suitable for showing a user or an agent verbatim. */
  reason: string;
}

/**
 * A single hit sharing one term is coincidence more often than evidence — the
 * word "cache" appears in a lot of notes. Two independent hits, or one hit
 * carrying an entity the query named, is where it stops being noise.
 */
const MIN_SUPPORTING_HITS = 2;

/**
 * Below this share of query terms, the result is thin enough that an agent
 * should hedge. Deliberately low: a five-word question whose terms appear once
 * each is still a real lead, and being too strict here re-creates the problem
 * of a retrieval layer that says "I don't know" about things it does know.
 */
const WEAK_COVERAGE = 0.34;

export function gradeRecall(result: RecallResult): RecallGrade {
  const queryTerms = new Set(tokenize(result.query));

  if (result.hits.length === 0) {
    return {
      verdict: "no-evidence",
      termCoverage: 0,
      supportingHits: 0,
      matchedRefs: [],
      reason:
        result.corpusSize === 0
          ? "The recall index is empty — nothing has been indexed yet."
          : `Nothing in ${result.corpusSize} indexed chunks matched this question.`,
    };
  }

  // An entity ref match is far stronger evidence than word overlap: a query
  // naming PTF-3774 and a chunk carrying PTF-3774 are about the same thing,
  // whereas sharing the word "service" means very little.
  const matchedRefs = [...new Set(result.hits.flatMap((h) => h.matchedRefs))].sort();

  let supportingHits = 0;
  const seenTerms = new Set<string>();
  for (const hit of result.hits) {
    const hitTerms = new Set(tokenize(`${hit.chunk.title} ${hit.chunk.text}`));
    let overlaps = false;
    for (const term of queryTerms) {
      if (hitTerms.has(term)) {
        seenTerms.add(term);
        overlaps = true;
      }
    }
    if (overlaps) supportingHits += 1;
  }

  const termCoverage = queryTerms.size === 0 ? 0 : seenTerms.size / queryTerms.size;

  // A query of pure stopwords tokenizes to nothing, so coverage is
  // meaningless rather than zero. Ranking still returned something; say the
  // result is unverified instead of asserting there is no evidence.
  if (queryTerms.size === 0) {
    return {
      verdict: "weak",
      termCoverage: 0,
      supportingHits,
      matchedRefs,
      reason: "The question has no distinctive terms to verify these results against.",
    };
  }

  if (matchedRefs.length > 0 && supportingHits >= 1) {
    return {
      verdict: "answerable",
      termCoverage,
      supportingHits,
      matchedRefs,
      reason: `Hits reference ${matchedRefs.join(", ")} from the question.`,
    };
  }

  if (supportingHits < MIN_SUPPORTING_HITS || termCoverage < WEAK_COVERAGE) {
    return {
      verdict: supportingHits === 0 ? "no-evidence" : "weak",
      termCoverage,
      supportingHits,
      matchedRefs,
      reason:
        supportingHits === 0
          ? `Top ${result.hits.length} chunks were the closest available but share no terms with the question.`
          : `Only ${supportingHits} ${supportingHits === 1 ? "chunk overlaps" : "chunks overlap"} the question (${Math.round(termCoverage * 100)}% of its terms).`,
    };
  }

  return {
    verdict: "answerable",
    termCoverage,
    supportingHits,
    matchedRefs,
    reason: `${supportingHits} chunks cover ${Math.round(termCoverage * 100)}% of the question's terms.`,
  };
}

/**
 * The line to put in front of an agent, before the citations.
 *
 * Returned as prose rather than a flag because this is consumed through an MCP
 * tool whose output is text — a `verdict` field is easy to ignore, a sentence
 * at the top of the payload is not.
 */
export function gradeHeadline(grade: RecallGrade): string {
  switch (grade.verdict) {
    case "no-evidence":
      return `⚠︎ No supporting evidence. ${grade.reason} Say so rather than answering from these chunks.`;
    case "weak":
      return `⚠︎ Weak evidence. ${grade.reason} Cite what is here; do not conclude beyond it.`;
    default:
      return `✓ ${grade.reason}`;
  }
}
