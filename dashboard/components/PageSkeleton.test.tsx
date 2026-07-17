import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PageSkeleton } from "./PageSkeleton";
import { SkeletonRows } from "./SkeletonRows";
import { EmptyState } from "./EmptyState";

describe("PageSkeleton (route loading states)", () => {
  it("renders page chrome with shimmering rows", () => {
    const html = renderToStaticMarkup(<PageSkeleton rows={6} variant="list" />);
    expect(html).toContain("page-wrapper");
    expect(html).toContain("page-header");
    expect(html).toContain('aria-busy="true"');
    expect((html.match(/skeleton/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });
});

describe("SkeletonRows", () => {
  it("block variant renders solid bars", () => {
    const html = renderToStaticMarkup(<SkeletonRows count={3} />);
    expect((html.match(/class="skeleton"/g) ?? []).length).toBe(3);
  });

  it("list variant renders dot + title + meta silhouettes per row", () => {
    const html = renderToStaticMarkup(<SkeletonRows count={2} variant="list" />);
    // 3 shimmer shapes per row
    expect((html.match(/skeleton/g) ?? []).length).toBe(6);
  });
});

describe("EmptyState quips", () => {
  it("shows a date-seeded quip when no subtitle is given", () => {
    const quips = ["Quiet.", "Very quiet."] as const;
    const html = renderToStaticMarkup(<EmptyState title="Nothing here." quips={quips} />);
    expect(quips.some((q) => html.includes(q))).toBe(true);
  });

  it("explicit subtitle wins over quips", () => {
    const html = renderToStaticMarkup(
      <EmptyState title="Nothing." subtitle="Real subtitle." quips={["Quip."]} />,
    );
    expect(html).toContain("Real subtitle.");
    expect(html).not.toContain("Quip.");
  });

  it("renders date-stable quips (same pick on re-render)", () => {
    const quips = ["A", "B", "C"];
    const a = renderToStaticMarkup(<EmptyState title="t" quips={quips} />);
    const b = renderToStaticMarkup(<EmptyState title="t" quips={quips} />);
    expect(a).toBe(b);
  });

  it("bare omits the card chrome", () => {
    const html = renderToStaticMarkup(<EmptyState bare title="Inside a card" />);
    expect(html).not.toContain('class="card');
    expect(html).toContain("Inside a card");
  });
});
