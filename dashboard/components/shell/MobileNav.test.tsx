// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileNav } from "./MobileNav";

const state = vi.hoisted(() => ({
  pathname: "/",
  setup: { github: true, calendar: true, datadog: true, completed: true } as Record<string, boolean>,
}));

vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
vi.mock("@/lib/hooks/use-setup-status", () => ({ useSetupStatus: () => state.setup }));
vi.mock("@/lib/hooks/use-nav-badges", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hooks/use-nav-badges")>()),
  useNavBadges: () => ({ counts: undefined, unseen: { tickets: false, prs: false }, calendarRemaining: 0 }),
}));
vi.mock("@/components/tasks/FocusTimer", () => ({ FocusTimer: () => null }));
vi.mock("@/components/shell/AccentPicker", () => ({ AccentPicker: () => null }));

beforeEach(() => {
  state.pathname = "/";
});
afterEach(cleanup);

function openDrawer() {
  render(<MobileNav />);
  fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
  return screen.getByRole("dialog", { name: "Main navigation" });
}

describe("MobileNav", () => {
  it("mirrors the sidebar groups, minus what a phone cannot reach", () => {
    const drawer = openDrawer();
    const groups = [...drawer.querySelectorAll(".nav-group-label")].map((el) => el.textContent);
    expect(groups).toEqual(["Workspace", "Library", "Tools", "System"]);
    expect(within(drawer).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Home", "Storyboard", "Tasks", "PRs", "Calendar",
      "Notes", "Search",
      "Datadog",
      "Agents", "Settings",
    ]);
  });

  it("uses the new names and none of the old ones", () => {
    const drawer = openDrawer();
    expect(within(drawer).getByRole("link", { name: "Tasks" })).toHaveAttribute("href", "/work");
    expect(within(drawer).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/status");
    for (const name of ["Work", "System", "Briefing", "QA", "Review", "Skills"]) {
      expect(within(drawer).queryByRole("link", { name })).toBeNull();
    }
  });

  it.each([
    ["/work", "Tasks"],
    ["/qa", "Settings"],
    ["/skills", "Settings"],
    ["/review", "Tasks"],
    ["/briefing", "Home"],
  ])("on %s the highlighted row is %s, as on desktop", (pathname, row) => {
    state.pathname = pathname;
    const drawer = openDrawer();
    const current = within(drawer).getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page");
    expect(current.map((l) => l.textContent)).toEqual([row]);
  });

  it("keeps its preferences group clear of the Settings link's name", () => {
    const drawer = openDrawer();
    expect(within(drawer).getByRole("group", { name: "Preferences" })).toBeInTheDocument();
    expect(within(drawer).queryByRole("group", { name: "Settings" })).toBeNull();
  });
});
