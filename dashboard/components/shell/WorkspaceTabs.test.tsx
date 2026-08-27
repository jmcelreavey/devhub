/** @vitest-environment jsdom */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import {
  WorkspaceTabPanels,
  WorkspaceTabStrip,
  WorkspaceTabsProvider,
  useWorkspaceTabs,
} from "@/components/shell/WorkspaceTabs";
import { WORKSPACE_TABS_STORAGE_KEY } from "@/lib/workspace-tabs";

const pathname = vi.hoisted(() => ({ current: "/" }));
const routerPush = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: routerPush, refresh: vi.fn() }),
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

describe("WorkspaceTabPanels keep-alive", () => {
  it("does not unmount a tab's page when switching away and back", () => {
    const unmounted: string[] = [];
    function Probe({ id }: { id: string }) {
      useEffect(() => {
        return () => {
          unmounted.push(id);
        };
      }, [id]);
      return (
        <div data-testid={`probe-${id}`}>
          {id}
          <iframe data-testid={`frame-${id}`} src="about:blank" title={id} />
        </div>
      );
    }

    const tree = (page: string) => (
      <WorkspaceTabsProvider>
        <Seed hrefs={["/work"]} />
        <WorkspaceTabStrip />
        <WorkspaceTabPanels>
          <Probe id={page} />
        </WorkspaceTabPanels>
      </WorkspaceTabsProvider>
    );

    const view = render(tree("today"));
    fireEvent.click(screen.getByText("seed"));

    pathname.current = "/work";
    view.rerender(tree("work"));

    expect(screen.getByTestId("probe-today")).toBeInTheDocument();
    expect(screen.getByTestId("probe-work")).toBeInTheDocument();
    expect(screen.getByTestId("frame-today")).toHaveAttribute("src", "about:blank");

    routerPush.mockClear();
    unmounted.length = 0;
    const todayTab = screen.getAllByRole("tab").find((t) => t.textContent?.includes("Today"));
    fireEvent.click(todayTab!);

    expect(unmounted).toEqual([]);
    expect(routerPush).not.toHaveBeenCalled();
    expect(screen.getByTestId("probe-today")).toBeInTheDocument();
    expect(screen.getByTestId("probe-work")).toBeInTheDocument();
    expect(screen.getByTestId("frame-today")).toHaveAttribute("src", "about:blank");
    expect(screen.getByTestId("frame-work")).toHaveAttribute("src", "about:blank");
    expect(screen.getByTestId("probe-today").closest("[data-workspace-tab-panel]")).not.toHaveAttribute(
      "hidden",
    );
    expect(screen.getByTestId("probe-work").closest("[data-workspace-tab-panel]")).toHaveAttribute(
      "hidden",
    );
  });

  it("does not paint Next's live tree into a pushState-active tab", () => {
    function Probe({ id }: { id: string }) {
      return <div data-testid={`probe-${id}`}>{id}</div>;
    }
    const tree = (page: string) => (
      <WorkspaceTabsProvider>
        <Seed hrefs={["/work"]} />
        <WorkspaceTabStrip />
        <WorkspaceTabPanels>
          <Probe id={page} />
        </WorkspaceTabPanels>
      </WorkspaceTabsProvider>
    );

    const view = render(tree("today"));
    fireEvent.click(screen.getByText("seed"));
    pathname.current = "/work";
    view.rerender(tree("work"));

    const todayTab = screen.getAllByRole("tab").find((t) => t.textContent?.includes("Today"));
    fireEvent.click(todayTab!);

    // Next still rendering /work after pushState. A stale RSC/HMR payload must
    // update the live /work tab, not clobber Today's frozen tree.
    view.rerender(tree("work-stale"));
    expect(screen.getByTestId("probe-today")).toHaveTextContent("today");
    expect(screen.getByTestId("probe-work-stale")).toHaveTextContent("work-stale");
    expect(screen.queryByTestId("probe-work")).toBeNull();
    expect(screen.getByTestId("probe-today").closest("[data-workspace-tab-panel]")).not.toHaveAttribute(
      "hidden",
    );
  });

  it("gives the active panel a definite height so full-bleed pages fill main", () => {
    render(
      <WorkspaceTabsProvider>
        <WorkspaceTabPanels>
          <div>today</div>
        </WorkspaceTabPanels>
      </WorkspaceTabsProvider>,
    );
    const panel = document.querySelector("[data-workspace-tab-panel]");
    expect(panel).toHaveClass("workspace-tab-panel");
    expect(panel?.parentElement).toHaveClass("workspace-tab-panels");
  });

  it("drops a closed tab's panel so it can remount next time", () => {
    function Probe({ id }: { id: string }) {
      return <div data-testid={`probe-${id}`}>{id}</div>;
    }
    const tree = (page: string) => (
      <WorkspaceTabsProvider>
        <Seed hrefs={["/work"]} />
        <WorkspaceTabStrip />
        <WorkspaceTabPanels>
          <Probe id={page} />
        </WorkspaceTabPanels>
      </WorkspaceTabsProvider>
    );

    const view = render(tree("today"));
    fireEvent.click(screen.getByText("seed"));
    pathname.current = "/work";
    view.rerender(tree("work"));

    fireEvent.click(screen.getByRole("button", { name: "Close Today" }));
    expect(screen.queryByTestId("probe-today")).toBeNull();
    expect(screen.getByTestId("probe-work")).toBeInTheDocument();
  });
});
