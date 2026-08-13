import { describe, expect, it } from "vitest";
import { gradeHeadline, gradeRecall } from "./grade";
import type { RecallHit, RecallResult } from "./types";

function hit(title: string, text: string, matchedRefs: string[] = []): RecallHit {
  return {
    chunk: {
      id: `note:${title}#0`,
      sourceKind: "note",
      sourceId: title,
      title,
      text,
      ts: 0,
      refs: [],
    },
    score: 1,
    signals: { lexical: 1, vector: 1, recency: 0, entity: 0 },
    snippet: text.slice(0, 80),
    matchedRefs,
    tokens: 10,
  } as RecallHit;
}

function result(query: string, hits: RecallHit[], corpusSize = 500): RecallResult {
  return {
    query,
    hits,
    queryRefs: [],
    relatedRefs: [],
    totalTokens: hits.length * 10,
    budgetTokens: 2000,
    corpusSize,
    truncated: 0,
    duplicates: 0,
    indexBuiltAt: new Date().toISOString(),
    tookMs: 1,
  } as RecallResult;
}

describe("gradeRecall", () => {
  it("refuses when nothing came back", () => {
    const grade = gradeRecall(result("kafka partition rebalance", []));
    expect(grade.verdict).toBe("no-evidence");
    expect(grade.reason).toContain("500 indexed chunks");
  });

  it("distinguishes an empty index from a genuine miss", () => {
    // "I have nothing indexed" and "I looked and found nothing" call for
    // different actions from the reader.
    const grade = gradeRecall(result("anything", [], 0));
    expect(grade.reason).toContain("index is empty");
  });

  it("refuses when the top hits share no terms with the question", () => {
    // The failure this whole module exists for: ranking is relative, so twelve
    // confident-looking citations come back even when none are relevant.
    const grade = gradeRecall(
      result("kafka partition rebalance", [
        hit("Holiday planning", "Flights to Lisbon and a hotel near the water"),
        hit("Recipe notes", "Sourdough starter needs feeding twice a day"),
      ]),
    );
    expect(grade.verdict).toBe("no-evidence");
    expect(grade.supportingHits).toBe(0);
  });

  it("answers when several hits cover the question's terms", () => {
    const grade = gradeRecall(
      result("kafka partition rebalance", [
        hit("Kafka ops", "partition rebalance storms after a broker restart"),
        hit("Runbook", "rebalance the kafka partition assignment carefully"),
      ]),
    );
    expect(grade.verdict).toBe("answerable");
    expect(grade.termCoverage).toBeGreaterThan(0.9);
  });

  it("calls a single thin overlap weak rather than answerable", () => {
    // One hit sharing one common word is coincidence more often than evidence.
    const grade = gradeRecall(
      result("kafka partition rebalance strategy", [
        hit("Storage notes", "we partition the table by tenant id"),
      ]),
    );
    expect(grade.verdict).toBe("weak");
    expect(grade.supportingHits).toBe(1);
    // Singular verb agreement — this string is shown to the user verbatim.
    expect(grade.reason).toContain("1 chunk overlaps");
  });

  it("trusts an entity match over word overlap", () => {
    // A query naming PTF-3774 and a chunk carrying PTF-3774 are about the same
    // thing, even when the prose shares almost nothing.
    const grade = gradeRecall(
      result("what happened with PTF-3774", [
        hit("Standup", "PTF-3774 blocked on review", ["jira:PTF-3774"]),
      ]),
    );
    expect(grade.verdict).toBe("answerable");
    expect(grade.matchedRefs).toEqual(["jira:PTF-3774"]);
  });

  it("does not claim no-evidence for a question with no distinctive terms", () => {
    // Pure stopwords tokenize to nothing, so coverage is meaningless rather
    // than zero — asserting "no evidence" would be a claim we cannot support.
    const grade = gradeRecall(result("what about it", [hit("Note", "some content here")]));
    expect(grade.verdict).toBe("weak");
    expect(grade.reason).toContain("no distinctive terms");
  });

  it("never discards hits, whatever the verdict", () => {
    // Grading labels; it does not filter. A hard score cutoff would silently
    // delete the only weak-but-real evidence in the vault.
    const hits = [hit("Unrelated", "nothing to do with the question")];
    const graded = result("kafka partition rebalance", hits);
    gradeRecall(graded);
    expect(graded.hits).toHaveLength(1);
  });
});

describe("gradeHeadline", () => {
  it("tells an agent to refuse on no-evidence", () => {
    const headline = gradeHeadline(gradeRecall(result("kafka rebalance", [])));
    expect(headline).toContain("No supporting evidence");
    expect(headline).toContain("rather than answering");
  });

  it("tells an agent to hedge on weak", () => {
    const grade = gradeRecall(
      result("kafka partition rebalance strategy", [hit("Storage", "we partition by tenant")]),
    );
    expect(gradeHeadline(grade)).toContain("do not conclude beyond it");
  });

  it("is unobtrusive when the evidence holds up", () => {
    const grade = gradeRecall(
      result("kafka rebalance", [
        hit("Kafka ops", "rebalance storms"),
        hit("Runbook", "kafka rebalance steps"),
      ]),
    );
    expect(gradeHeadline(grade).startsWith("✓")).toBe(true);
  });
});
