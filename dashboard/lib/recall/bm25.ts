/**
 * BM25 — the lexical half of hybrid retrieval.
 *
 * The existing `lexicalSearchNotes` uses plain TF-IDF, which has no document
 * length normalisation. In a vault where a 40-line learning note competes with
 * a 900-line daily note, that is not a subtle difference: the long note wins on
 * term frequency alone, every time, regardless of relevance. BM25's `b`
 * parameter is precisely the fix.
 */
import { termFrequency, tokenize } from "./tokenize";

/** Term-frequency saturation. 1.2 is the standard default and behaves well. */
const K1 = 1.2;
/** Length normalisation. 0.75 = mostly normalised, the usual choice. */
const B = 0.75;

export interface Bm25Doc {
  id: string;
  tokens: string[];
}

export interface Bm25Scored {
  id: string;
  score: number;
}

export class Bm25Index {
  private readonly docFreq = new Map<string, number>();
  private readonly termFreqs = new Map<string, Map<string, number>>();
  private readonly lengths = new Map<string, number>();
  private avgLength = 0;
  private docCount = 0;

  constructor(docs: readonly Bm25Doc[] = []) {
    for (const doc of docs) this.add(doc);
  }

  add(doc: Bm25Doc): void {
    const tf = termFrequency(doc.tokens);
    this.termFreqs.set(doc.id, tf);
    this.lengths.set(doc.id, doc.tokens.length);
    for (const term of tf.keys()) {
      this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
    }
    this.docCount += 1;
    const total = [...this.lengths.values()].reduce((sum, n) => sum + n, 0);
    this.avgLength = this.docCount === 0 ? 0 : total / this.docCount;
  }

  get size(): number {
    return this.docCount;
  }

  /**
   * Robertson/Sparck-Jones IDF with the +0.5 smoothing, floored at a small
   * positive value. Without the floor, a term appearing in more than half the
   * corpus scores *negative*, so a document containing the query term ranks
   * below one that doesn't — technically defensible, wildly unintuitive when
   * the query is a word you use in every note.
   */
  private idf(term: string): number {
    const df = this.docFreq.get(term) ?? 0;
    const raw = Math.log((this.docCount - df + 0.5) / (df + 0.5) + 1);
    return Math.max(raw, 0.01);
  }

  score(queryTokens: readonly string[], docId: string): number {
    const tf = this.termFreqs.get(docId);
    if (!tf) return 0;
    const length = this.lengths.get(docId) ?? 0;
    if (length === 0 || this.avgLength === 0) return 0;

    let score = 0;
    for (const term of new Set(queryTokens)) {
      const freq = tf.get(term);
      if (!freq) continue;
      const numerator = freq * (K1 + 1);
      const denominator = freq + K1 * (1 - B + (B * length) / this.avgLength);
      score += this.idf(term) * (numerator / denominator);
    }
    return score;
  }

  search(query: string, limit = 100): Bm25Scored[] {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const scored: Bm25Scored[] = [];
    for (const id of this.termFreqs.keys()) {
      const score = this.score(queryTokens, id);
      if (score > 0) scored.push({ id, score });
    }
    scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    return scored.slice(0, limit);
  }
}
