import { afterEach, describe, expect, it, vi } from "vitest";
import { cache } from "swr/_internal";
import type { GithubPrsApiPayload } from "@/lib/github/prs";
import type { GithubPrRow } from "@/lib/github/prs";
import type { useToast } from "@/lib/hooks/use-toast";
import { buildPrRowMenuGroups, openPrRowNote, type PrRowKind } from "@/components/PrRowActions";
import { NOTES_OPEN_PATH_EVENT } from "@/lib/notes/open-in-panel";

const toast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  dismiss: vi.fn(),
} as unknown as ReturnType<typeof useToast>;

function row(overrides: Partial<GithubPrRow> = {}): GithubPrRow {
  return {
    repo: "example-org/example-service",
    number: 123,
    title: "Example change",
    url: "https://github.com/example-org/example-service/pull/123",
    ...overrides,
  };
}

function itemIds(
  kind: PrRowKind,
  pr: GithubPrRow = row(),
  opts: { repLocked?: boolean } = {},
) {
  return buildPrRowMenuGroups({
    row: pr,
    kind,
    toast,
    openNote: vi.fn(),
    openRep: vi.fn(),
    ...opts,
  })
    .flatMap((group) => group.items)
    .map((item) => item.id);
}

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); for (const key of cache.keys()) cache.delete(key); });

describe("PR notes", () => {
  it.each([404, 500])("does not create an empty note when opening returns %s", async (status) => {
    const fetch = vi.fn(async () => new Response(null, { status }));
    vi.stubGlobal("fetch", fetch);
    const push = vi.fn();
    await openPrRowNote(row(), push, toast);
    expect(push).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]).toEqual(["/api/notes/pr-reviews/example-org-example-service-123", { cache: "no-store" }]);
    expect(status === 404 ? toast.info : toast.error).toHaveBeenCalled();
  });

});

describe("PR visibility across screens", () => {
  it.each(["authored", "reviews"] as const)("skips %s PRs in every profile cache without refetching", async (kind) => {
    const skipped = row();
    const kept = row({ number: 456, url: "https://github.com/example-org/example-service/pull/456" });
    const payload: GithubPrsApiPayload = { configured: true, authored: [skipped, kept], reviews: [skipped, kept], recentlyReviewed: [] };
    const keys = ["/api/github/prs", "/api/github/prs?taskProfile=work", "/api/github/prs?taskProfile=personal"];
    for (const key of [...keys, "/api/github/prs/owned"]) {
      const entry = { _k: key, data: payload };
      cache.set(key, entry);
    }
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    const skip = buildPrRowMenuGroups({ row: skipped, kind, toast, openNote: vi.fn() }).flatMap((group) => group.items).find((item) => item.id === "skip-pr")!;
    await skip.onSelect();
    for (const key of keys) {
      expect(cache.get(key)?.data).toMatchObject({ authored: [kept], reviews: [kept] });
    }
    expect(cache.get("/api/github/prs/owned")?.data).toEqual(payload);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/github/prs/skip", expect.objectContaining({ method: "POST" }));
  });
});

describe("buildPrRowMenuGroups", () => {
  it.each(["authored", "reviews", "reviewed"] as const)(
    "includes Copy PR URL for %s rows",
    (kind) => {
      expect(itemIds(kind)).toContain("copy-pr-url");
    },
  );

  it("adds Copy Jira URL when the title has a ticket key", () => {
    const ids = itemIds("authored", row({ title: "ABC-123 - Example change" }));
    expect(ids).toContain("copy-jira-url");
  });

  it("omits Copy Jira URL when there is no ticket key", () => {
    expect(itemIds("authored")).not.toContain("copy-jira-url");
  });

  it("offers agent review on authored and review-requested rows", () => {
    expect(itemIds("authored")).toContain("agent-review");
    expect(itemIds("reviews")).toContain("agent-review");
    expect(itemIds("reviewed")).not.toContain("agent-review");
  });

  it("offers Investigate pipeline on authored and review-requested rows", () => {
    expect(itemIds("authored")).toContain("investigate-pipeline");
    expect(itemIds("reviews")).toContain("investigate-pipeline");
    expect(itemIds("reviewed")).not.toContain("investigate-pipeline");
  });

  it("keeps pipeline investigation in Review when checks are failing", () => {
    const groups = buildPrRowMenuGroups({
      row: row({ checks: "failing" }),
      kind: "authored",
      toast,
      openNote: vi.fn(),
    });
    const review = groups.find((group) => group.id === "review");
    expect(review?.items.map((item) => item.id)).toEqual(["agent-review", "investigate-pipeline"]);
    const item = review?.items.find((item) => item.id === "investigate-pipeline");
    expect(item).toBeDefined();
    expect(item?.danger).not.toBe(true);
  });

  it("does not offer GitHub reviewer request from the PR menu", () => {
    expect(itemIds("authored")).not.toContain("request-review");
    expect(itemIds("reviews")).not.toContain("request-review");
  });

  it("locks agent review behind the daily rep when the rep is this PR", () => {
    expect(itemIds("reviews", row(), { repLocked: true })).toContain("daily-rep-first");
    expect(itemIds("reviews", row(), { repLocked: true })).not.toContain("agent-review");
    expect(itemIds("reviews")).toContain("agent-review");
    expect(itemIds("reviews")).not.toContain("daily-rep-first");
  });

  it("offers Skip until updated on authored and review-requested rows only", () => {
    expect(itemIds("authored")).toContain("skip-pr");
    expect(itemIds("reviews")).toContain("skip-pr");
    expect(itemIds("reviewed")).not.toContain("skip-pr");
  });

  it.each(["authored", "reviews"] as const)("omits ineffective skip actions for %s inventory and skipped rows", (kind) => {
    const groups = buildPrRowMenuGroups({ row: row(), kind, canSkip: false, toast, openNote: vi.fn() });
    expect(groups.flatMap((group) => group.items).map((item) => item.id)).not.toContain("skip-pr");
  });

  it("never locks authored rows", () => {
    expect(itemIds("authored", row(), { repLocked: true })).toContain("agent-review");
  });
});

describe("openPrRowNote", () => {
  it("opens the PR note in the Notes side panel rather than navigating away", async () => {
    const fetch = vi.fn(async () => Response.json({ content: [] }));
    vi.stubGlobal("fetch", fetch);
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    const onOpen = vi.fn();
    target.addEventListener(NOTES_OPEN_PATH_EVENT, onOpen);
    const push = vi.fn();
    try {
      await openPrRowNote(row(), push, toast);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(push).not.toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/notes/pr-reviews/example-org-example-service-123", { cache: "no-store" });
  });
});
