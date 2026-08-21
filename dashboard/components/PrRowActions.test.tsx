import { describe, expect, it, vi } from "vitest";
import type { GithubPrRow } from "@/lib/github/prs";
import type { useToast } from "@/lib/hooks/use-toast";
import { buildPrRowMenuGroups, type PrRowKind } from "@/components/PrRowActions";

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

  it("never locks authored rows", () => {
    expect(itemIds("authored", row(), { repLocked: true })).toContain("agent-review");
  });
});
