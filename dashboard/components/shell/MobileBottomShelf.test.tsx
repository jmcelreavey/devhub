// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NAV_ITEMS } from "@/lib/nav";
import { MobileBottomShelf } from "./MobileBottomShelf";

const route = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
vi.mock("@/lib/hooks/use-mobile-shelf", () => ({
  useMobileShelf: () => ({ collapsed: false, toggle: vi.fn() }),
}));

beforeEach(() => {
  route.pathname = "/";
});
afterEach(cleanup);

const activeLabels = () =>
  screen
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.textContent);

describe("MobileBottomShelf", () => {
  it("offers Home, Notes and Tasks, named as the sidebar names them", () => {
    render(<MobileBottomShelf />);
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Home", "Notes", "Tasks"]);
    // Same href, same label as the sidebar row: a rename can't leave the shelf behind.
    for (const link of links) {
      const row = NAV_ITEMS.find((item) => item.href === link.getAttribute("href"));
      expect(link.textContent).toBe(row?.label);
    }
  });

  it("keeps the shelf's own search and menu buttons", () => {
    render(<MobileBottomShelf />);
    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More" })).toBeInTheDocument();
  });

  it.each([
    ["/", "Home"],
    ["/work", "Tasks"],
    ["/notes/daily/2026-10-17", "Notes"],
    ["/briefing", "Home"],
    ["/review", "Tasks"],
    ["/review/rep", "Tasks"],
    ["/docs", "Notes"],
  ])("lights the same row the sidebar would on %s: %s", (pathname, label) => {
    route.pathname = pathname;
    render(<MobileBottomShelf />);
    expect(activeLabels()).toEqual([label]);
  });

  it.each(["/qa", "/skills", "/status", "/workflow"])("lights nothing on %s", (pathname) => {
    route.pathname = pathname;
    render(<MobileBottomShelf />);
    expect(activeLabels()).toEqual([]);
  });
});
