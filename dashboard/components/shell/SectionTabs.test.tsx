/** @vitest-environment jsdom */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ pathname: "/docs" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
vi.mock("@/lib/hooks/use-is-mobile", () => ({ useIsDesktopPointer: () => true }));
vi.mock("@/lib/hooks/use-setup-status", () => ({ useSetupStatus: () => ({ github: true }) }));

import { SectionTabs } from "./SectionTabs";

describe("SectionTabs", () => {
  it("renders nothing outside a section", () => {
    route.pathname = "/repos";
    const { container } = render(<SectionTabs />);
    expect(container.firstChild).toBeNull();
  });

  it("offers the strip and a menu form, both marking the current page", () => {
    route.pathname = "/docs";
    render(<SectionTabs />);
    const [strip, menu] = screen.getAllByRole("navigation", { name: "Section" });

    const current = within(strip).getByRole("link", { name: "Docs" });
    expect(current.getAttribute("aria-current")).toBe("page");

    const trigger = within(menu).getByRole("button", { name: /Section: Docs/ });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(within(menu).queryByRole("link")).toBeNull();
  });

  it("lists the sibling pages in the menu and closes after choosing one", () => {
    route.pathname = "/docs";
    render(<SectionTabs />);
    const menu = screen.getAllByRole("navigation", { name: "Section" })[1];
    fireEvent.click(within(menu).getByRole("button", { name: /Section: Docs/ }));

    const hrefs = within(menu)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(expect.arrayContaining(["/notes", "/docs", "/diagrams", "/radar"]));
    expect(within(menu).getByRole("link", { name: "Docs" }).getAttribute("aria-current")).toBe("page");

    fireEvent.click(within(menu).getByRole("link", { name: "Notes" }));
    expect(within(menu).queryByRole("link")).toBeNull();
  });

  it("closes on Escape and returns focus to the trigger", () => {
    route.pathname = "/docs";
    render(<SectionTabs />);
    const menu = screen.getAllByRole("navigation", { name: "Section" })[1];
    const trigger = within(menu).getByRole("button", { name: /Section: Docs/ });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(within(menu).queryByRole("link")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
