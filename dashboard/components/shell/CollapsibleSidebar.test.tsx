// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CollapsibleSidebar } from "./CollapsibleSidebar";

const state = vi.hoisted(() => ({
  pathname: "/",
  desktop: true,
  setup: { github: true, calendar: true, datadog: true, completed: true } as Record<string, boolean>,
}));

vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
vi.mock("@/lib/hooks/use-is-mobile", () => ({ useIsDesktopPointer: () => state.desktop }));
vi.mock("@/lib/hooks/use-setup-status", () => ({ useSetupStatus: () => state.setup }));
vi.mock("@/lib/hooks/use-client-mounted", () => ({ useClientMounted: () => true }));
vi.mock("@/lib/hooks/use-nav-badges", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hooks/use-nav-badges")>()),
  useNavBadges: () => ({ counts: undefined, unseen: { tickets: false, prs: false }, calendarRemaining: 0 }),
}));
vi.mock("@/components/releases/ReleaseNotes", () => ({ WhatsNewPill: () => null }));
vi.mock("@/components/ui/IconPicker", () => ({ IconPicker: () => null }));
vi.mock("./RuntimeBrandProvider", () => ({ useRuntimeBrand: () => ({ brand: null }) }));

beforeEach(() => {
  state.pathname = "/";
  state.desktop = true;
  state.setup = { github: true, calendar: true, datadog: true, completed: true };
});
afterEach(cleanup);

const groupLabels = (container: HTMLElement) =>
  [...container.querySelectorAll(".nav-group-label")].map((el) => el.textContent);
const rowNames = () => screen.getAllByRole("link").map((link) => link.textContent);
const currentRows = () =>
  screen.getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page").map((link) => link.textContent);

describe("CollapsibleSidebar", () => {
  it("lists the twelve core destinations under Workspace, Library, Tools and System", () => {
    const { container } = render(<CollapsibleSidebar />);
    expect(groupLabels(container)).toEqual(["Workspace", "Library", "Tools", "System"]);
    expect(rowNames()).toEqual([
      "Home", "Storyboard", "Tasks", "PRs", "Calendar",
      "Notes", "Search", "Repos",
      "Datadog", "Databases",
      "Agents", "Settings",
    ]);
  });

  it("no longer has rows for the pages that were renamed or demoted", () => {
    render(<CollapsibleSidebar />);
    for (const name of ["Work", "System", "Briefing", "QA", "Review", "Skills", "Infrastructure"]) {
      expect(screen.queryByRole("link", { name })).toBeNull();
    }
    // The old URLs are still where the new rows point.
    expect(screen.getByRole("link", { name: "Tasks" })).toHaveAttribute("href", "/work");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/status");
  });

  it("drops desktop-only rows on a touch screen", () => {
    state.desktop = false;
    render(<CollapsibleSidebar />);
    expect(rowNames()).not.toContain("Databases");
    expect(rowNames()).not.toContain("Repos");
  });

  it("keeps integration gating: no PRs, Calendar or Datadog until they are connected", () => {
    state.setup = { completed: true };
    const { container } = render(<CollapsibleSidebar />);
    expect(rowNames()).toEqual(["Home", "Storyboard", "Tasks", "Notes", "Search", "Repos", "Databases", "Agents", "Settings"]);
    // Tools still shows: Databases needs no integration.
    expect(groupLabels(container)).toContain("Tools");
  });

  it.each([
    ["/", "Home"],
    ["/work", "Tasks"],
    ["/db", "Databases"],
    ["/status", "Settings"],
    ["/logs", "Settings"],
    ["/qa", "Settings"],
    ["/skills", "Settings"],
    ["/review", "Tasks"],
    ["/review/rep", "Tasks"],
    ["/briefing", "Home"],
    ["/docs", "Notes"],
    ["/datadog", "Datadog"],
  ])("on %s the highlighted row is %s", (pathname, row) => {
    state.pathname = pathname;
    render(<CollapsibleSidebar />);
    expect(currentRows()).toEqual([row]);
  });

  it("highlights nothing on a page with no home", () => {
    state.pathname = "/recall";
    render(<CollapsibleSidebar />);
    expect(currentRows()).toEqual([]);
  });
});
