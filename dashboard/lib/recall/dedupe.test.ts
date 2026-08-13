import { describe, expect, it } from "vitest";
import { dedupeSignature, isNearDuplicate, jaccard } from "./dedupe";

const sig = (text: string, refs: string[] = []) => dedupeSignature(text, refs);

describe("dedupeSignature", () => {
  it("drops letterless tokens — the volatile part of repeated text", () => {
    const signature = sig("Tasks 2026-07-30");
    expect(signature.vocab.has("2026")).toBe(false);
    // The tokenizer keeps the hyphenated date whole, so this is the form that
    // actually has to be excluded.
    expect(signature.vocab.has("2026-07-30")).toBe(false);
    expect(signature.vocab.has("task")).toBe(true);
  });

  it("keeps identifiers that merely contain a digit", () => {
    // `s3` and `oauth2` carry meaning; throwing them away would blunt the
    // comparison on exactly the technical vocabulary that distinguishes notes.
    expect(sig("upload to s3 via oauth2").vocab.has("s3")).toBe(true);
    expect(sig("upload to s3 via oauth2").vocab.has("oauth2")).toBe(true);
  });

  it("makes ref order irrelevant", () => {
    expect(sig("x", ["b", "a"]).refKey).toBe(sig("x", ["a", "b"]).refKey);
  });
});

describe("jaccard", () => {
  it("is 1 for identical sets and 0 for disjoint ones", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1);
    expect(jaccard(new Set(["a"]), new Set(["b"]))).toBe(0);
  });

  it("treats two empty sets as identical and one empty set as disjoint", () => {
    expect(jaccard(new Set(), new Set())).toBe(1);
    expect(jaccard(new Set(["a"]), new Set())).toBe(0);
  });

  it("is symmetric", () => {
    const a = new Set(["a", "b", "c"]);
    const b = new Set(["b", "c", "d"]);
    expect(jaccard(a, b)).toBe(jaccard(b, a));
  });
});

describe("isNearDuplicate", () => {
  const rolled = (date: string) =>
    sig(`# Tasks ${date}\n- (open) Address BI Jobs Feedback [PTF-4484]`, ["jira:PTF-4484"]);

  it("catches the same rolled-over task on different days", () => {
    // The exact case that motivated this module.
    expect(isNearDuplicate(rolled("2026-07-30"), rolled("2026-08-05"))).toBe(true);
  });

  it("does not collapse the same wording under different tickets", () => {
    const a = sig("- (open) Address BI Jobs Feedback [PTF-4484]", ["jira:PTF-4484"]);
    const b = sig("- (open) Address BI Jobs Feedback [PTF-9999]", ["jira:PTF-9999"]);
    // Identical vocabulary, different entity. Two tickets, not one duplicated.
    expect(isNearDuplicate(a, b)).toBe(false);
  });

  it("does not collapse different notes that share a topic", () => {
    const a = sig("Cache warming runs from a cron job walking the sitemap nightly");
    const b = sig("Cache eviction is LRU with a hard ceiling on total object count");
    expect(isNearDuplicate(a, b)).toBe(false);
  });

  it("does not collapse two chunks of one long note about one ticket", () => {
    const a = sig("The surrogate key purge is eventually consistent", ["jira:PTF-1"]);
    const b = sig("Rollback required a manual invalidation of the edge tier", ["jira:PTF-1"]);
    expect(isNearDuplicate(a, b)).toBe(false);
  });

  it("refuses to suppress on the strength of a two-word chunk", () => {
    const a = sig("ok fine", ["jira:PTF-1"]);
    const b = sig("ok fine", ["jira:PTF-1"]);
    expect(isNearDuplicate(a, b)).toBe(false);
  });

  it("is symmetric", () => {
    const a = rolled("2026-07-30");
    const b = rolled("2026-08-05");
    expect(isNearDuplicate(a, b)).toBe(isNearDuplicate(b, a));
  });
});
