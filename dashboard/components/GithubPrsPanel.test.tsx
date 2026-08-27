/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GithubPrsPanel } from "@/components/GithubPrsPanel";
import { GridSizeContext } from "@/lib/hooks/use-grid-size";
import type { GithubPrsApiPayload, GithubPrRow } from "@/lib/github/prs";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/PrRow", () => ({
  PrRow: ({ row, kind }: { row: GithubPrRow; kind: string }) => (
    <div data-testid={`pr-row-${kind}`}>{row.title}</div>
  ),
}));

const payloads = new Map<string, GithubPrsApiPayload>();

vi.mock("@/lib/hooks/use-fetch", () => ({
  useLive: (key: string) => ({ data: payloads.get(key), error: undefined, isLoading: false }),
}));

function row(title: string, number: number): GithubPrRow {
  return {
    number,
    title,
    url: `https://github.com/org/repo/pull/${number}`,
    repo: "org/repo",
    author: { login: "someone" },
  };
}

function setPayload(partial: Partial<GithubPrsApiPayload>) {
  payloads.set("/api/github/prs", {
    configured: true,
    authored: [],
    reviews: [],
    recentlyReviewed: [],
    ...partial,
  });
}

afterEach(cleanup);

describe("GithubPrsPanel column size", () => {
  it("lists review requests with PrRows, not just the first authored title", () => {
    setPayload({
      authored: [row("Update Job Scout Open Graph thumbnail", 1)],
      reviews: [row("Review me one", 2), row("Review me two", 3)],
    });
    render(
      <GridSizeContext.Provider value={{ github: { w: 4, h: 14 } }}>
        <GithubPrsPanel />
      </GridSizeContext.Provider>,
    );
    expect(screen.getAllByTestId("pr-row-reviews")).toHaveLength(2);
    expect(screen.queryByTestId("pr-row-authored")).toBeNull();
    expect(screen.getByText("Review me one")).toBeTruthy();
    expect(screen.getByText("Review me two")).toBeTruthy();
  });

  it("lets mine/review counts switch the list", () => {
    setPayload({
      authored: [row("My PR", 1)],
      reviews: [row("Needs review", 2)],
    });
    render(
      <GridSizeContext.Provider value={{ github: { w: 4, h: 14 } }}>
        <GithubPrsPanel />
      </GridSizeContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /1 mine/i }));
    expect(screen.getByTestId("pr-row-authored").textContent).toBe("My PR");
    expect(screen.queryByTestId("pr-row-reviews")).toBeNull();
  });
});
