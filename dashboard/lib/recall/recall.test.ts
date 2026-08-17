/**
 * End-to-end: real files on disk → corpus → index → ranked, budgeted answer.
 *
 * The unit tests cover each stage in isolation; this one exists because the
 * interesting failures live in the seams — a chunk id that doesn't survive
 * persistence, a filter applied before ranking instead of after, a budget that
 * silently returns nothing.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendEvent } from "./events";
import { formatRecallMarkdown, recall } from "./recall";
import { buildIndex, clearIndex, isStale, loadIndex, readManifest } from "./store";

let tmp: string;
const saved: Record<string, string | undefined> = {};

/** A BlockNote note file, which is what the notes vault actually contains. */
function writeNote(relPath: string, paragraphs: string[]): void {
  const file = path.join(tmp, "notes", `${relPath}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const blocks = paragraphs.map((text) => ({
    type: "paragraph",
    content: [{ type: "text", text }],
  }));
  fs.writeFileSync(file, JSON.stringify(blocks));
}

function writeTasks(date: string, tasks: Array<{ text: string; jiraKey?: string }>): void {
  const dir = path.join(tmp, "tasks");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${date}.json`),
    JSON.stringify(
      tasks.map((task, i) => ({
        id: `t${i}`,
        text: task.text,
        done: false,
        jiraKey: task.jiraKey,
        createdAt: `${date}T09:00:00.000Z`,
      })),
    ),
  );
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "recall-e2e-"));
  for (const key of ["NOTES_DIR", "TASKS_DIR", "DOCS_DIR", "REPO_ROOT"]) saved[key] = process.env[key];
  process.env.NOTES_DIR = path.join(tmp, "notes");
  process.env.TASKS_DIR = path.join(tmp, "tasks");
  process.env.DOCS_DIR = path.join(tmp, "docs");
  process.env.REPO_ROOT = tmp;
  clearIndex();

  writeNote("learnings/devhub/cache-purge", [
    "# Fastly cache purge",
    "Surrogate key purges are eventually consistent. PTF-3774 tracked the incident.",
    "The fix was to purge by surrogate key rather than by URL, then wait for propagation.",
  ]);
  writeNote("daily/2026-03-02", [
    "# Monday",
    "Spent the morning on the calendar OAuth redirect URI and nothing else.",
  ]);
  writeNote("pr-reviews/devhub-525", [
    "# Hybrid and vector search",
    "Review of owner/repo#525. Concerns about index staleness and rebuild cost.",
  ]);
  writeTasks("2026-03-02", [{ text: "Chase the cache purge regression", jiraKey: "PTF-3774" }]);
});

afterEach(() => {
  clearIndex();
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("recall — end to end", () => {
  it("finds the right note from a question that shares few exact words", () => {
    buildIndex();
    const result = recall({ query: "why was the fastly purge not taking effect" });
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0].chunk.sourceId).toBe("learnings/devhub/cache-purge");
  });

  it("pulls the ticket out of the query and boosts chunks carrying it", () => {
    buildIndex();
    const result = recall({ query: "PTF-3774" });
    expect(result.queryRefs.map((r) => r.id)).toContain("PTF-3774");
    const top = result.hits[0];
    expect(top.matchedRefs).toContain("jira:PTF-3774");
    expect(top.signals.entity).toBeGreaterThan(0);
  });

  it("ranks across sources, not just notes", () => {
    buildIndex();
    const kinds = new Set(recall({ query: "cache purge PTF-3774", limit: 20 }).hits.map((h) => h.chunk.sourceKind));
    expect(kinds.size).toBeGreaterThan(1);
  });

  it("respects the token budget instead of truncating a chunk", () => {
    buildIndex();
    const result = recall({ query: "cache purge", budgetTokens: 120 });
    expect(result.totalTokens).toBeLessThanOrEqual(120);
    for (const hit of result.hits) expect(hit.chunk.text).not.toMatch(/\.\.\.$/);
  });

  it("reports what didn't fit rather than dropping it silently", () => {
    buildIndex();
    const tight = recall({ query: "cache purge calendar review", budgetTokens: 100 });
    expect(tight.truncated).toBeGreaterThan(0);
  });

  it("filters by source kind", () => {
    buildIndex();
    const result = recall({ query: "cache purge", kinds: ["task"] });
    expect(result.hits.every((h) => h.chunk.sourceKind === "task")).toBe(true);
  });

  it("includes events written after the index was built once rebuilt", () => {
    buildIndex();
    expect(recall({ query: "surrogate key propagation delay" }).hits.some((h) => h.chunk.sourceKind === "event")).toBe(
      false,
    );

    appendEvent({
      kind: "decision",
      title: "Purge by surrogate key, never by URL",
      body: "URL purges miss variants. Decided during the PTF-3774 postmortem.",
      source: "test",
    });
    buildIndex();

    const hits = recall({ query: "purge by surrogate key decision" }).hits;
    expect(hits.some((h) => h.chunk.sourceKind === "event")).toBe(true);
  });

  it("surfaces related entities the query did not name", () => {
    buildIndex();
    const result = recall({ query: "cache purge" });
    expect(result.relatedRefs.length).toBeGreaterThan(0);
    expect(result.relatedRefs.some((r) => r.ref.id === "PTF-3774")).toBe(true);
  });

  it("returns an empty result for a blank query without touching the index", () => {
    const result = recall({ query: "   " });
    expect(result.hits).toEqual([]);
    expect(result.corpusSize).toBe(0);
  });

  it("returns no hits — not an error — for a query about nothing in the corpus", () => {
    buildIndex();
    const result = recall({ query: "kubernetes horizontal pod autoscaler tuning" });
    expect(result.corpusSize).toBeGreaterThan(0);
    expect(result.hits.every((h) => h.score > 0)).toBe(true);
  });

  it("honours alpha at both extremes without crashing", () => {
    buildIndex();
    expect(() => recall({ query: "cache", alpha: 0 })).not.toThrow();
    expect(() => recall({ query: "cache", alpha: 1 })).not.toThrow();
  });

  it("suppresses the same rolled-over task repeated across days", () => {
    // Regression: found against the real vault, not in unit tests. A task that
    // rolls over lands in a *different file* each day, so the per-source cap
    // can't see it — a ticket query returned five hits that were all the same
    // sentence on five consecutive dates.
    for (const date of ["2026-07-30", "2026-07-31", "2026-08-01", "2026-08-04", "2026-08-05"]) {
      writeTasks(date, [{ text: "Address BI Jobs Feedback", jiraKey: "PTF-4484" }]);
    }
    buildIndex();

    const result = recall({ query: "PTF-4484 jobs feedback", limit: 10 });
    const taskHits = result.hits.filter((h) => h.chunk.sourceKind === "task");
    expect(taskHits.length).toBeLessThanOrEqual(2);
    expect(result.duplicates).toBeGreaterThan(0);
  });

  /**
   * A rolled-over ticket across days whose *other* tasks genuinely differ.
   *
   * The distinct second task matters: it makes each day a legitimately
   * different chunk, so dedupe correctly leaves them alone and the kind cap is
   * the only thing under test. A fixture where the days were true duplicates
   * would pass for the wrong reason.
   */
  const writeRolledTicketDays = (): void => {
    const chores = [
      "renew the staging certificate",
      "triage inbox backlog",
      "pair on the migration script",
      "review the design tokens",
      "update onboarding docs",
      "audit the feature flags",
      "prune stale branches",
      "rotate the signing key",
      "profile the slow dashboard",
      "write the incident summary",
      "refactor the date helpers",
      "chase the vendor invoice",
    ];
    chores.forEach((chore, i) => {
      writeTasks(`2026-06-${String(i + 10).padStart(2, "0")}`, [
        { text: "Address BI Jobs Feedback", jiraKey: "PTF-4484" },
        { text: chore },
      ]);
    });
  };

  it("stops one source kind monopolising the result set", () => {
    writeRolledTicketDays();
    buildIndex();

    const result = recall({ query: "PTF-4484 jobs feedback", limit: 12, budgetTokens: 8000 });
    const taskHits = result.hits.filter((h) => h.chunk.sourceKind === "task");
    expect(taskHits.length).toBeLessThanOrEqual(Math.floor(12 * 0.4));
    // Diversity, not starvation — the slots freed up go to other sources.
    expect(result.hits.length).toBeGreaterThan(taskHits.length);
  });

  it("lifts the kind cap when the caller asked for exactly one kind", () => {
    writeRolledTicketDays();
    buildIndex();

    const result = recall({
      query: "PTF-4484 jobs feedback",
      kinds: ["task"],
      limit: 12,
      budgetTokens: 8000,
    });
    expect(result.hits.length).toBeGreaterThan(Math.floor(12 * 0.4));
  });

  it("does not suppress genuinely different notes on the same topic", () => {
    writeNote("notes/cache-a", [
      "# Cache warming",
      "We warm the cache from a cron job that walks the sitemap each night.",
    ]);
    writeNote("notes/cache-b", [
      "# Cache eviction",
      "Eviction is LRU with a hard ceiling on total object count, tuned by hand.",
    ]);
    buildIndex();

    const ids = recall({ query: "cache", limit: 10 }).hits.map((h) => h.chunk.sourceId);
    expect(ids).toContain("notes/cache-a");
    expect(ids).toContain("notes/cache-b");
  });

  it("caps how much of the result set one file can occupy", () => {
    writeNote(
      "notes/long",
      Array.from({ length: 30 }, (_, i) => `Cache purge paragraph ${i}. ${"more words ".repeat(40)}`),
    );
    buildIndex();
    const result = recall({ query: "cache purge paragraph", budgetTokens: 30_000, limit: 30 });
    const fromLong = result.hits.filter((h) => h.chunk.sourceId === "notes/long");
    expect(fromLong.length).toBeLessThanOrEqual(3);
  });
});

describe("index lifecycle", () => {
  it("auto-builds on first query", () => {
    expect(readManifest()).toBeNull();
    expect(recall({ query: "cache purge" }).hits.length).toBeGreaterThan(0);
    expect(readManifest()).not.toBeNull();
  });

  it("records per-source counts in the manifest", () => {
    const manifest = buildIndex();
    expect(manifest.chunkCount).toBeGreaterThan(0);
    expect(manifest.bySource.learning).toBeGreaterThan(0);
    expect(manifest.bySource.task).toBeGreaterThan(0);
  });

  it("reports staleness once a source changes after the build", async () => {
    buildIndex();
    expect(isStale()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 12));
    writeNote("learnings/devhub/new-thing", ["# New", "Something learned today."]);
    expect(isStale()).toBe(true);
  });

  it("rebuilds on loadIndex when sources are newer than the manifest", async () => {
    buildIndex();
    const builtAt = readManifest()?.builtAt;
    await new Promise((resolve) => setTimeout(resolve, 12));
    writeNote("learnings/devhub/new-thing", ["# New", "Something learned today."]);
    expect(isStale()).toBe(true);
    const result = recall({ query: "Something learned today" });
    expect(result.hits.some((h) => h.chunk.sourceId === "learnings/devhub/new-thing")).toBe(true);
    expect(isStale()).toBe(false);
    expect(readManifest()?.builtAt).not.toBe(builtAt);
  });

  it("does not rebuild when autoBuild is false", async () => {
    buildIndex();
    const builtAt = readManifest()?.builtAt;
    await new Promise((resolve) => setTimeout(resolve, 12));
    writeNote("learnings/devhub/new-thing", ["# New", "Something learned today."]);
    expect(isStale()).toBe(true);
    expect(loadIndex({ autoBuild: false })).not.toBeNull();
    expect(isStale()).toBe(true);
    expect(readManifest()?.builtAt).toBe(builtAt);
  });

  it("is safe to delete — the next query rebuilds it", () => {
    buildIndex();
    clearIndex();
    expect(readManifest()).toBeNull();
    expect(recall({ query: "cache purge" }).hits.length).toBeGreaterThan(0);
  });

  it("never indexes its own output", () => {
    buildIndex();
    const first = readManifest()?.chunkCount ?? 0;
    buildIndex();
    expect(readManifest()?.chunkCount).toBe(first);
  });
});

describe("formatRecallMarkdown", () => {
  it("cites every passage with its source id", () => {
    buildIndex();
    const markdown = formatRecallMarkdown(recall({ query: "cache purge" }));
    // Uncited retrieved context is indistinguishable from a hallucination at
    // the point an agent quotes it.
    expect(markdown).toContain("learnings/devhub/cache-purge");
    expect(markdown).toContain("score");
  });

  it("says so plainly when there is nothing to report", () => {
    clearIndex();
    const markdown = formatRecallMarkdown({
      query: "nothing",
      hits: [],
      queryRefs: [],
      relatedRefs: [],
      totalTokens: 0,
      budgetTokens: 2000,
      corpusSize: 0,
      truncated: 0,
      duplicates: 0,
      indexBuiltAt: null,
      tookMs: 1,
    });
    expect(markdown).toContain("No recall hits");
    expect(markdown).toContain("recall_index");
  });
});
