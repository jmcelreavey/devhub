/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePrStatusMenu, type PrStatusPillBind } from "@/components/github/PrStatusMenu";
import type { PrStatusMenuTarget } from "@/lib/github/pr-status-menu";

const mocks = vi.hoisted(() => ({
  openInBrowser: vi.fn(),
  copy: vi.fn(),
  push: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("@/lib/desktop/bridge", () => ({ openInBrowser: mocks.openInBrowser }));
vi.mock("@/lib/clipboard", () => ({ copyTextToClipboard: mocks.copy }));
vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ success: mocks.success, error: mocks.error, info: vi.fn(), dismiss: vi.fn() }),
}));

const target: PrStatusMenuTarget = {
  url: "https://github.com/example-org/example-service/pull/123",
  repo: "example-org/example-service",
  number: 123,
  branch: "feat/payments",
  localRepoName: "example-service",
  checks: "failing",
};

function Pill({ pillTarget = target }: { pillTarget?: PrStatusMenuTarget | null }) {
  const menu = usePrStatusMenu(pillTarget ?? null);
  return (
    <>
      <button type="button" aria-label="CI failing" {...menu.bind}>
        CI failing
      </button>
      {menu.menuNode}
    </>
  );
}

function openFrom(key: string, init?: KeyboardEventInit) {
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  render(<Pill />);
  const pill = screen.getByRole("button", { name: "CI failing" });
  fireEvent.keyDown(pill, { key, ...init });
  return { pill, open };
}

function menuItem(name: RegExp) {
  return screen.getByRole("menuitem", { name, hidden: true });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("usePrStatusMenu", () => {
  it("opens from the context menu key and from Shift+F10", () => {
    const { open } = openFrom("ContextMenu");
    expect(menuItem(/Open PR in GitHub/)).toBeTruthy();
    expect(menuItem(/Open failing checks/)).toBeTruthy();
    cleanup();

    openFrom("F10", { shiftKey: true });
    expect(menuItem(/Copy branch name/)).toBeTruthy();
    expect(open).not.toHaveBeenCalled();
  });

  it("groups GitHub and DevHub navigation before copying, with icons throughout", () => {
    openFrom("ContextMenu");
    expect([...document.querySelectorAll(".context-menu-group-label")].map((node) => node.textContent)).toEqual(["GitHub", "DevHub", "Copy"]);
    const items = screen.getAllByRole("menuitem", { hidden: true });
    expect(items).toHaveLength(8);
    for (const item of items) expect(item.querySelector(".context-menu-icon svg")).not.toBeNull();
    expect(menuItem(/Open failing checks/).getAttribute("data-danger")).toBeNull();
    expect(items.slice(-3).map((item) => item.querySelector(".context-menu-label")?.textContent)).toEqual([
      "Copy PR link", "Copy PR reference", "Copy branch name",
    ]);
  });

  it("opens GitHub through the desktop opener, not window.open", () => {
    const { open } = openFrom("ContextMenu");
    fireEvent.click(menuItem(/Open failing checks/));
    expect(mocks.openInBrowser).toHaveBeenCalledWith(
      "https://github.com/example-org/example-service/pull/123/checks",
    );
    expect(open).not.toHaveBeenCalled();
  });

  it("copies the branch and opens the DevHub repo view", async () => {
    mocks.copy.mockResolvedValue(undefined);
    openFrom("F10", { shiftKey: true });
    fireEvent.click(menuItem(/Copy branch name/));
    expect(mocks.copy).toHaveBeenCalledWith("feat/payments");

    cleanup();
    openFrom("ContextMenu");
    fireEvent.click(menuItem(/Open repo in DevHub/));
    expect(mocks.push).toHaveBeenCalledWith("/repos/example-service");
  });

  it("does not open a menu when the pill has no pull request", () => {
    render(<Pill pillTarget={null} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "CI failing" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "CI failing" }), { key: "ContextMenu" });
    expect(document.querySelector('[role="menu"]:not([hidden])')).toBeNull();
  });

  it("keeps the pill marked so a parent row menu does not take the event", () => {
    render(<Pill />);
    const pill = screen.getByRole("button", { name: "CI failing" });
    const bind: PrStatusPillBind = {
      "data-entity-chip": "",
      "data-pr-status-pill": "",
      onContextMenu: () => {},
      onKeyDown: () => {},
    };
    expect(pill.getAttribute("data-entity-chip")).toBe(bind["data-entity-chip"]);
    expect(pill.getAttribute("data-pr-status-pill")).toBe("");
  });
});
