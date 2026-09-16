import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { GithubPrRow } from "@/lib/github/prs";
import {
  parseAutoReviewAllowlist,
  selectAutoReviewCandidates,
  runAutoPrReview,
  autoReviewConcurrency,
} from "@/lib/github/auto-pr-review";

function pr(partial: Partial<GithubPrRow> & Pick<GithubPrRow, "number" | "repo" | "url">): GithubPrRow {
  return {
    title: partial.title ?? `PR ${partial.number}`,
    updatedAt: partial.updatedAt ?? "2026-09-10T12:00:00.000Z",
    ...partial,
  };
}

describe("selectAutoReviewCandidates", () => {
  const a = pr({ repo: "acme/app", number: 1, url: "https://github.com/acme/app/pull/1" });
  const b = pr({ repo: "acme/api", number: 2, url: "https://github.com/acme/api/pull/2" });
  const c = pr({ repo: "other/x", number: 3, url: "https://github.com/other/x/pull/3" });

  it("skips drafts", () => {
    const { toStart, skipped } = selectAutoReviewCandidates({
      reviews: [a, b],
      draftUrls: new Set([a.url]),
      concurrency: 2,
    });
    expect(toStart.map((x) => x.row.url)).toEqual([b.url]);
    expect(skipped).toContainEqual({ repo: a.repo, number: a.number, url: a.url, reason: "draft" });
  });

  it("respects allowlist when set", () => {
    const { toStart, skipped } = selectAutoReviewCandidates({
      reviews: [a, c],
      allowlist: new Set(["acme/app"]),
      concurrency: 2,
    });
    expect(toStart).toHaveLength(1);
    expect(toStart[0]?.row.repo).toBe("acme/app");
    expect(skipped.some((s) => s.reason === "not-allowlisted" && s.url === c.url)).toBe(true);
  });

  it("dedupes on head SHA even after updatedAt moves (comments, labels)", () => {
    const withSha = { ...a, headSha: "abc123", updatedAt: "2026-09-12T00:00:00.000Z" };
    const same = selectAutoReviewCandidates({
      reviews: [withSha],
      priorByUrl: new Map([[a.url, { updatedAt: "2026-09-01T00:00:00.000Z", headSha: "abc123" }]]),
      concurrency: 2,
    });
    expect(same.toStart).toHaveLength(0);
    expect(same.skipped[0]?.reason).toBe("already-reviewed-head");

    const pushed = selectAutoReviewCandidates({
      reviews: [{ ...withSha, headSha: "def456" }],
      priorByUrl: new Map([[a.url, { updatedAt: withSha.updatedAt, headSha: "abc123" }]]),
      concurrency: 2,
    });
    expect(pushed.toStart).toHaveLength(1);
  });

  it("skips rows flagged draft by the list query", () => {
    const { toStart } = selectAutoReviewCandidates({ reviews: [{ ...a, draft: true }], concurrency: 2 });
    expect(toStart).toHaveLength(0);
  });

  it("dedupes when prior start matches updatedAt", () => {
    const { toStart, skipped } = selectAutoReviewCandidates({
      reviews: [a],
      priorByUrl: new Map([[a.url, { updatedAt: a.updatedAt! }]]),
      concurrency: 2,
    });
    expect(toStart).toHaveLength(0);
    expect(skipped[0]?.reason).toBe("already-reviewed-head");
  });

  it("re-queues when updatedAt moved past prior start", () => {
    const { toStart } = selectAutoReviewCandidates({
      reviews: [a],
      priorByUrl: new Map([[a.url, { updatedAt: "2026-09-01T00:00:00.000Z" }]]),
      concurrency: 2,
    });
    expect(toStart).toHaveLength(1);
  });

  it("skips when review note mtime covers PR updatedAt", () => {
    const notePath = "pr-reviews/acme-app-1.json";
    const prMs = Date.parse(a.updatedAt!);
    const { toStart, skipped } = selectAutoReviewCandidates({
      reviews: [a],
      noteActivityByPath: new Map([[notePath, prMs + 60_000]]),
      concurrency: 2,
    });
    expect(toStart).toHaveLength(0);
    expect(skipped[0]?.reason).toBe("note-covers-updatedAt");
  });

  it("caps concurrency and marks the rest", () => {
    const { toStart, skipped } = selectAutoReviewCandidates({
      reviews: [a, b, c],
      concurrency: 2,
    });
    expect(toStart).toHaveLength(2);
    expect(skipped.filter((s) => s.reason === "concurrency-cap")).toHaveLength(1);
  });
});

describe("parseAutoReviewAllowlist / concurrency", () => {
  it("parses comma-separated repos", () => {
    expect(parseAutoReviewAllowlist("acme/app, other/x")).toEqual(new Set(["acme/app", "other/x"]));
    expect(parseAutoReviewAllowlist("")).toBeNull();
    expect(parseAutoReviewAllowlist(undefined)).toBeNull();
  });

  it("clamps concurrency to 1–2", () => {
    expect(autoReviewConcurrency("1")).toBe(1);
    expect(autoReviewConcurrency("9")).toBe(2);
    expect(autoReviewConcurrency("")).toBe(2);
  });
});

describe("runAutoPrReview", () => {
  it("dry-run lists candidates without calling start", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-auto-review-"));
    process.env.NOTES_DIR = tmp;
    const row = pr({ repo: "acme/app", number: 9, url: "https://github.com/acme/app/pull/9" });
    let calls = 0;
    const result = await runAutoPrReview({
      reviews: [row],
      dryRun: true,
      concurrency: 1,
      startReview: async () => {
        calls += 1;
        return { sessionId: "never" };
      },
    });
    expect(calls).toBe(0);
    expect(result.dryRun).toBe(true);
    expect(result.started).toHaveLength(0);
    expect(result.candidates).toHaveLength(1);
    expect(result.skipped.some((s) => s.reason === "dry-run")).toBe(true);
  });

  it("starts within concurrency and records results", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-auto-review-"));
    process.env.NOTES_DIR = tmp;
    const rows = [
      pr({ repo: "acme/app", number: 1, url: "https://github.com/acme/app/pull/1" }),
      pr({ repo: "acme/app", number: 2, url: "https://github.com/acme/app/pull/2" }),
    ];
    const startedIds: string[] = [];
    const result = await runAutoPrReview({
      reviews: rows,
      concurrency: 1,
      startReview: async ({ row }) => {
        startedIds.push(row.url);
        return { sessionId: `ses-${row.number}` };
      },
    });
    expect(startedIds).toHaveLength(1);
    expect(result.started).toHaveLength(1);
    expect(result.started[0]?.sessionId).toBe("ses-1");
    expect(result.skipped.some((s) => s.reason === "concurrency-cap")).toBe(true);
  });
});

describe("runAutoPrReview draft probing", () => {
  const row = (n: number, draft?: boolean): GithubPrRow => ({
    repo: "acme/app",
    number: n,
    url: `https://github.com/acme/app/pull/${n}`,
    title: `PR ${n}`,
    updatedAt: "2026-09-10T12:00:00.000Z",
    ...(draft === undefined ? {} : { draft }),
  });

  it("probes only chosen rows and backfills a slot freed by a draft", async () => {
    const notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-autoreview-probe-"));
    const prev = process.env.NOTES_DIR;
    process.env.NOTES_DIR = notesDir;
    try {
      const probed: number[] = [];
      const result = await runAutoPrReview({
        reviews: [row(201), row(202, false), row(203), row(204)],
        dryRun: true,
        concurrency: 2,
        allowlist: null,
        probeDraft: async (r) => {
          probed.push(r.number);
          return r.number === 201;
        },
      });
      expect(result.candidates?.map((c) => c.row.number)).toEqual([202, 203]);
      expect(probed.sort()).toEqual([201, 203]);
    } finally {
      if (prev === undefined) delete process.env.NOTES_DIR;
      else process.env.NOTES_DIR = prev;
      fs.rmSync(notesDir, { recursive: true, force: true });
    }
  });
});
