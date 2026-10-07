// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryNav, type LibraryNavGroup } from "./LibraryNav";

const route = vi.hoisted(() => ({ pathname: "/notes/area/pr-reviews" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => route.pathname,
}));

const groups: LibraryNavGroup[] = [
  {
    id: "pr-reviews",
    label: "PR reviews",
    items: [
      { slug: "pr-reviews/acme-capi-2", title: "Postrefs migration", href: "/notes/pr-reviews/acme-capi-2", section: "capi" },
      { slug: "pr-reviews/acme-capi-1", title: "Search endpoint", href: "/notes/pr-reviews/acme-capi-1", section: "capi" },
      { slug: "pr-reviews/acme-atlas-9", title: "Bridge contract", href: "/notes/pr-reviews/acme-atlas-9", section: "atlas" },
      { slug: "pr-reviews/loose", title: "Unfiled review", href: "/notes/pr-reviews/loose" },
    ],
  },
];

function renderNav(search = "") {
  return render(
    <LibraryNav
      groups={groups}
      search={search}
      basePath="/notes/area"
      storageKey="test:notes-nav"
      label="Notes"
      kind="notes"
    />,
  );
}

beforeEach(() => {
  route.pathname = "/notes/area/pr-reviews";
  sessionStorage.clear();
});
afterEach(cleanup);

describe("LibraryNav sections", () => {
  it("opens the active group as a list of collapsed sections, loose items after", () => {
    renderNav();

    expect(screen.getByRole("button", { name: /capi/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /atlas/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Postrefs migration")).toBeNull();
    expect(screen.getByText("Unfiled review")).toBeInTheDocument();
  });

  it("opens the section holding the note being read", () => {
    route.pathname = "/notes/pr-reviews/acme-capi-1";
    renderNav();

    expect(screen.getByRole("button", { name: /capi/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Search endpoint")).toHaveAttribute("data-active", "true");
    expect(screen.queryByText("Bridge contract")).toBeNull();
  });

  it("toggles a section and remembers it", () => {
    const view = renderNav();
    fireEvent.click(screen.getByRole("button", { name: /atlas/ }));
    expect(screen.getByText("Bridge contract")).toBeInTheDocument();

    view.unmount();
    renderNav();
    expect(screen.getByText("Bridge contract")).toBeInTheDocument();
  });

  it("never hides search results behind a collapsed section, and matches section names", () => {
    route.pathname = "/notes";
    renderNav("capi");

    expect(screen.getByText("Postrefs migration")).toBeInTheDocument();
    expect(screen.getByText("Search endpoint")).toBeInTheDocument();
    expect(screen.queryByText("Bridge contract")).toBeNull();
  });
});
