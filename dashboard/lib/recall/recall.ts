/**
 * `recall(query, budget)` — the thing that replaces `buildContextPack`.
 *
 * The old context pack is a fixed bundle: open tasks, the eight most recent
 * learnings, 1200 characters of today's note. It has no idea what you asked,
 * so it is simultaneously too much (paying for eight learnings when one is
 * relevant) and too little (the answer is in a note from March and never
 * appears). `.slice(0, 8)` was the entire retrieval strategy.
 *
 * This is query-aware, ranked, budgeted, and cited. Same idea, opposite
 * direction: instead of guessing what you'll need, it answers what you asked
 * and spends the token budget on the best available evidence.
 */
import { entityKey } from "@/lib/entity-note";
import { bestSnippet } from "./chunk";
import { dedupeSignature, isNearDuplicate, type DedupeSignature } from "./dedupe";
import { cosine, getEmbedder } from "./embed";
import { combineScores, entityScore, recencyScore, reciprocalRankFusion } from "./fuse";
import { relatedRefsForHits } from "./graph";
import { extractRefs } from "./refs";
import { loadIndex } from "./store";
import { estimateTokens, tokenize } from "./tokenize";
import { gradeHeadline, gradeRecall, type RecallGrade } from "./grade";
import type { RecallChunk, RecallHit, RecallQuery, RecallResult } from "./types";

/** How many candidates each retriever contributes before fusion. */
const CANDIDATE_DEPTH = 150;


/**
 * Ceiling on how much of a result set one source kind may occupy.
 *
 * Also a real-vault finding. Even after duplicate suppression, a ticket query
 * filled most of its slots with daily task files: the same ticket appears on
 * every day it stayed open, and because each day carries a *different mix* of
 * other tasks, those chunks are legitimately distinct — dedupe can't touch
 * them, and shouldn't.
 *
 * But "this ticket was open for nine days" is not what anyone is asking, and
 * spending nine of twelve slots saying it crowds out the note that explains
 * what the ticket was actually about. Diversity is the fix, not stricter
 * deduplication.
 *
 * Skipped when the caller has explicitly asked for a single kind — at that
 * point they have said what they want and capping it would be second-guessing.
 */
const MAX_KIND_SHARE = 0.4;
const MIN_KIND_ALLOWANCE = 3;

const DEFAULTS = {
  limit: 12,
  budgetTokens: 2000,
  alpha: 0.5,
} as const;

function emptyResult(query: string, budgetTokens: number, tookMs: number): RecallResult {
  return {
    query,
    hits: [],
    queryRefs: [],
    relatedRefs: [],
    totalTokens: 0,
    budgetTokens,
    corpusSize: 0,
    truncated: 0,
    duplicates: 0,
    indexBuiltAt: null,
    tookMs,
  };
}

export function recall(input: RecallQuery): RecallResult {
  const startedAt = Date.now();
  const query = input.query.trim();
  const limit = input.limit ?? DEFAULTS.limit;
  const budgetTokens = input.budgetTokens ?? DEFAULTS.budgetTokens;
  const alpha = Math.min(1, Math.max(0, input.alpha ?? DEFAULTS.alpha));

  if (!query) return emptyResult(input.query, budgetTokens, Date.now() - startedAt);

  const index = loadIndex();
  if (!index) return emptyResult(query, budgetTokens, Date.now() - startedAt);

  const kindFilter = input.kinds && input.kinds.length > 0 ? new Set(input.kinds) : null;
  const candidates: RecallChunk[] = index.chunks.filter((chunk) => {
    if (kindFilter && !kindFilter.has(chunk.sourceKind)) return false;
    if (input.since && chunk.ts < input.since) return false;
    return true;
  });

  if (candidates.length === 0) {
    return { ...emptyResult(query, budgetTokens, Date.now() - startedAt), indexBuiltAt: index.manifest.builtAt };
  }

  const allowed = new Set(candidates.map((chunk) => chunk.id));
  const queryTokens = tokenize(query);
  const queryRefs = extractRefs(query);
  const queryRefKeys = queryRefs.map((ref) => entityKey(ref));

  // --- Lexical ranking -----------------------------------------------------
  const lexicalRanked = index.bm25
    .search(query, CANDIDATE_DEPTH * 2)
    .filter((row) => allowed.has(row.id))
    .slice(0, CANDIDATE_DEPTH);
  const lexicalScores = new Map(lexicalRanked.map((row) => [row.id, row.score]));

  // --- Vector ranking ------------------------------------------------------
  const queryVector = getEmbedder().embed(query);
  const vectorScored: Array<{ id: string; score: number }> = [];
  for (const chunk of candidates) {
    const vec = index.vectors.get(chunk.id);
    if (!vec) continue;
    const score = cosine(queryVector, vec);
    if (score > 0) vectorScored.push({ id: chunk.id, score });
  }
  vectorScored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const vectorRanked = vectorScored.slice(0, CANDIDATE_DEPTH);
  const vectorScores = new Map(vectorRanked.map((row) => [row.id, row.score]));

  // --- Fusion --------------------------------------------------------------
  const fused = reciprocalRankFusion([
    { ids: lexicalRanked.map((row) => row.id), weight: 1 - alpha },
    { ids: vectorRanked.map((row) => row.id), weight: alpha },
  ]);

  const byId = new Map(candidates.map((chunk) => [chunk.id, chunk]));
  const now = Date.now();

  const scored = [...fused.entries()]
    .map(([id, fusedScore]) => {
      const chunk = byId.get(id);
      if (!chunk) return null;
      const recency = recencyScore(chunk.ts, now);
      const entity = entityScore(chunk.refs, queryRefKeys);
      return {
        chunk,
        score: combineScores({ id, fused: fusedScore, recency, entity }),
        signals: {
          lexical: Math.round((lexicalScores.get(id) ?? 0) * 1000) / 1000,
          vector: Math.round((vectorScores.get(id) ?? 0) * 1000) / 1000,
          recency: Math.round(recency * 1000) / 1000,
          entity: Math.round(entity * 1000) / 1000,
        },
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id));

  // --- Budget packing ------------------------------------------------------
  //
  // Greedy by score, skipping anything that doesn't fit rather than stopping at
  // the first overflow: one 900-token chunk shouldn't lock out three 200-token
  // ones that would all have fitted. Skipping also can't starve — the loop
  // still terminates at `limit`.
  const hits: RecallHit[] = [];
  let totalTokens = 0;
  let truncated = 0;
  let duplicates = 0;
  const seenSources = new Map<string, number>();
  const seenKinds = new Map<string, number>();
  const acceptedSignatures: DedupeSignature[] = [];
  const kindAllowance =
    kindFilter && kindFilter.size === 1
      ? Number.POSITIVE_INFINITY
      : Math.max(MIN_KIND_ALLOWANCE, Math.floor(limit * MAX_KIND_SHARE));

  for (const row of scored) {
    if (hits.length >= limit) {
      truncated += 1;
      continue;
    }
    const tokens = estimateTokens(row.chunk.text);
    if (totalTokens + tokens > budgetTokens) {
      truncated += 1;
      continue;
    }

    // At most three chunks from one file. Without this a single long note
    // wins every slot and the result set stops being a survey of what's known.
    const sourceCount = seenSources.get(row.chunk.sourceId) ?? 0;
    if (sourceCount >= 3) {
      truncated += 1;
      continue;
    }

    const kindCount = seenKinds.get(row.chunk.sourceKind) ?? 0;
    if (kindCount >= kindAllowance) {
      truncated += 1;
      continue;
    }

    // Near-duplicate suppression. At most `limit` comparisons per candidate,
    // and only for candidates that already passed the budget and source caps —
    // so the signature is never built for a chunk that wasn't going to be
    // returned anyway.
    const signature = dedupeSignature(row.chunk.text, row.chunk.refs);
    if (acceptedSignatures.some((accepted) => isNearDuplicate(signature, accepted))) {
      duplicates += 1;
      continue;
    }
    acceptedSignatures.push(signature);

    seenSources.set(row.chunk.sourceId, sourceCount + 1);
    seenKinds.set(row.chunk.sourceKind, kindCount + 1);

    hits.push({
      chunk: row.chunk,
      score: Math.round(row.score * 10_000) / 10_000,
      signals: row.signals,
      snippet: bestSnippet(row.chunk.text, queryTokens),
      matchedRefs: row.chunk.refs.filter((ref) => queryRefKeys.includes(ref)),
      tokens,
    });
    totalTokens += tokens;
  }

  return {
    query,
    hits,
    queryRefs,
    relatedRefs: relatedRefsForHits(hits, queryRefKeys),
    totalTokens,
    budgetTokens,
    corpusSize: candidates.length,
    truncated,
    duplicates,
    indexBuiltAt: index.manifest.builtAt,
    tookMs: Date.now() - startedAt,
  };
}

const SOURCE_LABEL: Record<string, string> = {
  note: "Note",
  learning: "Learning",
  doc: "Doc",
  task: "Tasks",
  event: "Event",
  diagram: "Diagram",
};

/**
 * Markdown rendering for MCP consumers.
 *
 * Every block is cited with its source id. That is the whole point: an agent
 * quoting recalled context must be able to say where it came from, and the
 * user must be able to open the file and check. Uncited retrieved context is
 * indistinguishable from a hallucination at the point of use.
 */
export function formatRecallMarkdown(
  result: RecallResult,
  grade: RecallGrade = gradeRecall(result),
): string {

  if (result.hits.length === 0) {
    return `No recall hits for "${result.query}".${
      result.corpusSize === 0 ? " The index is empty — build it with `recall_index`." : ""
    }`;
  }

  const lines: string[] = [
    `# Recall — "${result.query}"`,
    "",
    // The verdict goes above the citations, not into a field beside them. This
    // payload is consumed by an agent as text; a `verdict` key is easy to skip,
    // a sentence before the evidence is not. That ordering is the whole point —
    // a model that reads twelve confident-looking snippets first has already
    // started building an answer by the time it reaches a caveat.
    gradeHeadline(grade),
    "",
    `_${result.hits.length} of ${result.corpusSize} chunks · ${result.totalTokens}/${result.budgetTokens} tokens · ${result.tookMs}ms_`,
    "",
  ];

  if (result.queryRefs.length > 0) {
    lines.push(`**Entities in query:** ${result.queryRefs.map((r) => r.label).join(", ")}`, "");
  }

  for (const hit of result.hits) {
    const label = SOURCE_LABEL[hit.chunk.sourceKind] ?? hit.chunk.sourceKind;
    lines.push(
      `## ${hit.chunk.title}`,
      `\`${label}\` · \`${hit.chunk.sourceId}\` · score ${hit.score.toFixed(3)}` +
        (hit.matchedRefs.length > 0 ? ` · matches ${hit.matchedRefs.join(", ")}` : ""),
      "",
      hit.chunk.text,
      "",
    );
  }

  if (result.relatedRefs.length > 0) {
    lines.push(
      "---",
      "",
      `**Related:** ${result.relatedRefs.map((r) => `${r.ref.label} (${r.weight})`).join(" · ")}`,
    );
  }

  return lines.join("\n");
}
