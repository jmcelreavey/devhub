/** @vitest-environment jsdom */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WorkspaceTabStrip,
  WorkspaceTabsProvider,
  useWorkspaceTabs,
} from "@/components/shell/WorkspaceTabs";
import { WORKSPACE_TABS_STORAGE_KEY } from "@/lib/workspace-tabs";

const pathname = vi.hoisted(() => ({ current: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

/** Opens tabs from inside the provider so the strip has something to render. */
function Seed({ hrefs }: { hrefs: string[] }) {
  const { newTab } = useWorkspaceTabs();
  return (
    <button type="button" onClick={() => hrefs.forEach((h) => newTab(h))}>
      seed
    </button>
  );
}

function renderStrip(hrefs: string[] = []) {
  const view = render(
    <WorkspaceTabsProvider>
      <Seed hrefs={hrefs} />
      <WorkspaceTabStrip />
    </WorkspaceTabsProvider>,
  );
  if (hrefs.length > 0) fireEvent.click(screen.getByText("seed"));
  return view;
}

beforeEach(() => {
  pathname.current = "/";
  window.localStorage.removeItem(WORKSPACE_TABS_STORAGE_KEY);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("WorkspaceTabStrip structure", () => {
  /**
   * A tablist that owns non-tab children reports the wrong count and position
   * to assistive tech — "tab 1 of 3" when there are two tabs and a button.
   */
  it("puts only tabs inside the tablist", () => {
    renderStrip(["/work"]);
    const tablist = screen.getByRole("tablist", { name: "Workspace tabs" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs.length).toBeGreaterThan(0);
    expect(within(tablist).queryByRole("button", { name: "New tab" })).toBeNull();
    expect(tablist.querySelector("p")).toBeNull();
  });

  it("still renders the New tab button, outside the tablist", () => {
    renderStrip();
    expect(screen.getByRole("button", { name: "New tab" })).toBeInTheDocument();
  });

  it("shows the repo-group disambiguation only on /repos", () => {
    const hint = /repo group filters/i;
    renderStrip();
    expect(screen.queryByText(hint)).toBeNull();

    pathname.current = "/repos";
    renderStrip();
    expect(screen.getByText(hint)).toBeInTheDocument();
  });
});

describe("WorkspaceTabStrip keyboard navigation", () => {
  /** Roving tabindex: the strip is one tab stop, arrows move within it. */
  it("exposes exactly one tab stop", () => {
    renderStrip(["/work", "/repos"]);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.filter((t) => t.getAttribute("tabindex") === "0")).toHaveLength(1);
    expect(tabs.find((t) => t.getAttribute("aria-selected") === "true")).toHaveAttribute(
      "tabindex",
      "0",
    );
  });

  it("ArrowLeft and ArrowRight move the selection", () => {
    renderStrip(["/work", "/repos"]);
    const selected = () =>
      screen.getAllByRole("tab").findIndex((t) => t.getAttribute("aria-selected") === "true");

    const last = screen.getAllByRole("tab").length - 1;
    expect(selected()).toBe(last);

    fireEvent.keyDown(screen.getAllByRole("tab")[last]!, { key: "ArrowLeft" });
    expect(selected()).toBe(last - 1);

    fireEvent.keyDown(screen.getAllByRole("tab")[last - 1]!, { key: "ArrowRight" });
    expect(selected()).toBe(last);
  });

  it("Home and End jump to the ends", () => {
    renderStrip(["/work", "/repos"]);
    const selected = () =>
      screen.getAllByRole("tab").findIndex((t) => t.getAttribute("aria-selected") === "true");
    const last = screen.getAllByRole("tab").length - 1;

    fireEvent.keyDown(screen.getAllByRole("tab")[last]!, { key: "Home" });
    expect(selected()).toBe(0);

    fireEvent.keyDown(screen.getAllByRole("tab")[0]!, { key: "End" });
    expect(selected()).toBe(last);
  });

  it("does not run off either end", () => {
    renderStrip(["/work"]);
    const tabs = () => screen.getAllByRole("tab");
    const selected = () => tabs().findIndex((t) => t.getAttribute("aria-selected") === "true");

    fireEvent.keyDown(tabs()[selected()]!, { key: "Home" });
    fireEvent.keyDown(tabs()[0]!, { key: "ArrowLeft" });
    expect(selected()).toBe(0);

    fireEvent.keyDown(tabs()[0]!, { key: "End" });
    const last = tabs().length - 1;
    fireEvent.keyDown(tabs()[last]!, { key: "ArrowRight" });
    expect(selected()).toBe(last);
  });

  it("activates on Enter and Space", () => {
    renderStrip(["/work"]);
    const first = screen.getAllByRole("tab")[0]!;
    fireEvent.keyDown(first, { key: "Enter" });
    expect(first).toHaveAttribute("aria-selected", "true");

    const last = screen.getAllByRole("tab").at(-1)!;
    fireEvent.keyDown(last, { key: " " });
    expect(last).toHaveAttribute("aria-selected", "true");
  });

  /** The close button must not also trigger the tab's own key handling. */
  it("keeps the close button out of the roving tab order when inactive", () => {
    renderStrip(["/work", "/repos"]);
    const tabs = screen.getAllByRole("tab");
    const inactive = tabs.find((t) => t.getAttribute("aria-selected") !== "true")!;
    const close = within(inactive).getByRole("button", { name: /^Close / });
    expect(close).toHaveAttribute("tabindex", "-1");
  });
});
