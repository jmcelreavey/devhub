// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BriefingOwnedReposDigest } from "@/components/briefing/BriefingOwnedReposDigest";

describe("BriefingOwnedReposDigest", () => {
  it("renders attention rows with repo name and reasons", () => {
    render(
      <BriefingOwnedReposDigest
        rows={[
          {
            repo: { fullName: "org/widgets" },
            attention: { score: 8, reasons: ["3 unpushed commits", "missing README"] },
          },
        ]}
      />,
    );
    expect(screen.getByLabelText("Owned repositories needing attention")).toBeInTheDocument();
    expect(screen.getByText("org/widgets")).toBeInTheDocument();
    expect(screen.getByText(/3 unpushed commits/)).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/own/org/widgets");
  });

  it("returns null for empty rows", () => {
    const { container } = render(<BriefingOwnedReposDigest rows={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("returns null when every row is unnamed", () => {
    const { container } = render(
      <BriefingOwnedReposDigest rows={[{ repo: {} }, { attention: { reasons: ["x"] } }]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  /** Slicing before filtering used to turn a bad row into a missing one. */
  it("keeps four usable rows even when unnamed rows come first", () => {
    render(
      <BriefingOwnedReposDigest
        rows={[
          { repo: { fullName: "   " } },
          ...["a", "b", "c", "d"].map((n) => ({ repo: { fullName: `org/${n}` } })),
        ]}
      />,
    );
    expect(screen.getAllByRole("link")).toHaveLength(4);
    expect(screen.getByText("org/d")).toBeInTheDocument();
  });

  it("falls back to /repos when the name has no owner", () => {
    render(<BriefingOwnedReposDigest rows={[{ repo: { fullName: "widgets" } }]} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/repos/widgets");
  });
});
