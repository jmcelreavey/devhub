/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  clampMenuPosition,
  CONTEXT_MENU_MIN_WIDTH,
  CONTEXT_MENU_VIEWPORT_MARGIN as MARGIN,
  ContextMenu,
  ROW_LONG_PRESS_MOVE_PX,
  ROW_LONG_PRESS_MS,
  RowMenuKebab,
  useContextMenu,
  type ContextMenuGroup,
} from "@/components/shell/ContextMenu";

const groups: ContextMenuGroup[] = [
  {
    id: "main",
    items: [{ id: "noop", label: "Do the thing", onSelect: () => {} }],
  },
];

function LongPressHarness({ onOpen }: { onOpen: (x: number, y: number) => void }) {
  const menu = useContextMenu<string>();
  if (menu.target && menu.position) {
    onOpen(menu.position.x, menu.position.y);
  }
  return (
    <div data-testid="row" {...menu.bindRow("row")}>
      Row
    </div>
  );
}

describe("useContextMenu bindRow long-press", () => {
  it("opens at the press point after 500ms", () => {
    vi.useFakeTimers();
    const onOpen = vi.fn();
    render(<LongPressHarness onOpen={onOpen} />);
    const row = screen.getByTestId("row");

    fireEvent.pointerDown(row, { pointerType: "touch", pointerId: 1, clientX: 40, clientY: 80 });
    expect(onOpen).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(ROW_LONG_PRESS_MS);
    });

    expect(onOpen).toHaveBeenCalledWith(40, 80);
    vi.useRealTimers();
  });

  it("cancels when the pointer moves more than 8px", () => {
    vi.useFakeTimers();
    const onOpen = vi.fn();
    render(<LongPressHarness onOpen={onOpen} />);
    const row = screen.getByTestId("row");

    fireEvent.pointerDown(row, { pointerType: "touch", pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(row, {
      pointerType: "touch",
      pointerId: 1,
      clientX: 10 + ROW_LONG_PRESS_MOVE_PX + 1,
      clientY: 10,
    });
    act(() => {
      vi.advanceTimersByTime(ROW_LONG_PRESS_MS);
    });

    expect(onOpen).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("cancels on pointercancel", () => {
    vi.useFakeTimers();
    const onOpen = vi.fn();
    render(<LongPressHarness onOpen={onOpen} />);
    const row = screen.getByTestId("row");

    fireEvent.pointerDown(row, { pointerType: "touch", pointerId: 1, clientX: 12, clientY: 24 });
    fireEvent.pointerCancel(row, { pointerType: "touch", pointerId: 1 });
    act(() => {
      vi.advanceTimersByTime(ROW_LONG_PRESS_MS);
    });

    expect(onOpen).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

function CardRootHarness() {
  const menu = useContextMenu<string>();
  return (
    <div data-testid="card" {...menu.bindRow("repo")}>
      <a href="https://example.com" data-testid="title">
        Title
      </a>
      <span data-testid="padding">padding</span>
      <RowMenuKebab label="Actions for repo" onOpen={(x, y) => menu.openAtPoint(x, y, "repo")} />
      {menu.target ? <div data-testid="menu-open" /> : null}
    </div>
  );
}

describe("bindRow on the card/row container", () => {
  it("opens from contextmenu on the container, not only the kebab", () => {
    render(<CardRootHarness />);
    fireEvent.contextMenu(screen.getByTestId("card"), { clientX: 40, clientY: 80 });
    expect(screen.getByTestId("menu-open")).toBeTruthy();
  });

  it("opens from contextmenu on nested padding and links", () => {
    render(<CardRootHarness />);
    fireEvent.contextMenu(screen.getByTestId("padding"), { clientX: 12, clientY: 24 });
    expect(screen.getByTestId("menu-open")).toBeTruthy();
  });

  it("keeps the kebab in-flow on the container", () => {
    render(<CardRootHarness />);
    const kebab = screen.getByRole("button", { name: "Actions for repo" });
    expect(kebab.className).toContain("row-menu-kebab");
    expect(screen.getByTestId("card").contains(kebab)).toBe(true);
  });
});

describe("ContextMenu Escape capture", () => {
  it("closes the menu and does not let Escape reach an enclosing dialog listener", () => {
    const onClose = vi.fn();
    const dialogEscape = vi.fn();
    document.addEventListener("keydown", dialogEscape);

    render(
      <ContextMenu
        open
        position={{ x: 16, y: 16 }}
        groups={groups}
        onClose={onClose}
      />,
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialogEscape).not.toHaveBeenCalled();
    document.removeEventListener("keydown", dialogEscape);
  });
});

describe("clampMenuPosition", () => {
  const viewport = { width: 1000, height: 800 };

  it("keeps the pointer coords when the menu fits", () => {
    expect(
      clampMenuPosition(40, 80, { width: 240, height: 120 }, viewport),
    ).toEqual({ left: 40, top: 80 });
  });

  it("does not pin to the top-right when size is 0 (unmeasured popover)", () => {
    expect(
      clampMenuPosition(40, 80, { width: 0, height: 0 }, viewport),
    ).toEqual({ left: 40, top: 80 });
  });

  it("flips left using min-width when an unmeasured menu would overflow the right edge", () => {
    expect(
      clampMenuPosition(980, 10, { width: 0, height: 0 }, viewport),
    ).toEqual({ left: viewport.width - CONTEXT_MENU_MIN_WIDTH - MARGIN, top: 10 });
  });

  it("flips up when the menu would overflow the bottom edge", () => {
    expect(
      clampMenuPosition(40, 760, { width: 240, height: 120 }, viewport),
    ).toEqual({ left: 40, top: viewport.height - 120 - MARGIN });
  });

  it("caps height when the menu is taller than the viewport", () => {
    const available = viewport.height - 2 * MARGIN;
    expect(
      clampMenuPosition(40, 80, { width: 240, height: 2000 }, viewport),
    ).toEqual({ left: 40, top: MARGIN, maxHeight: available });
  });
});

function mockMenuRect(size: { width: number; height: number }) {
  return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: size.width,
    height: size.height,
    top: 0,
    left: 0,
    bottom: size.height,
    right: size.width,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

function stubViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: { width, height, offsetTop: 0, offsetLeft: 0 },
  });
}

describe("ContextMenu pointer origin", () => {
  it("opens at the pointer, not 0,0 or the top-right", () => {
    render(
      <ContextMenu
        open
        position={{ x: 40, y: 80 }}
        groups={groups}
        onClose={() => {}}
      />,
    );
    const menu = document.querySelector(".context-menu");
    expect(menu).toBeTruthy();
    if (!(menu instanceof HTMLElement)) throw new Error("expected menu element");
    expect(menu.style.top).toBe("80px");
    expect(menu.style.left).toBe("40px");
    expect(menu.style.right).toBe("auto");
    expect(menu.style.bottom).toBe("auto");
  });

  it("applies maxHeight and overflow-y when the measured menu is taller than the viewport", () => {
    const rect = mockMenuRect({ width: 240, height: 2000 });
    stubViewport(1000, 800);

    render(
      <ContextMenu
        open
        position={{ x: 40, y: 80 }}
        groups={groups}
        onClose={() => {}}
      />,
    );

    const menu = document.querySelector(".context-menu");
    if (!(menu instanceof HTMLElement)) throw new Error("expected menu element");
    expect(menu.style.maxHeight).toBe(`${800 - 2 * MARGIN}px`);
    expect(menu.style.overflowY).toBe("auto");
    expect(menu.style.top).toBe(`${MARGIN}px`);
    rect.mockRestore();
  });

  it("shifts top up when a fitting menu would overflow the bottom", () => {
    const rect = mockMenuRect({ width: 240, height: 120 });
    stubViewport(1000, 800);

    render(
      <ContextMenu
        open
        position={{ x: 40, y: 760 }}
        groups={groups}
        onClose={() => {}}
      />,
    );

    const menu = document.querySelector(".context-menu");
    if (!(menu instanceof HTMLElement)) throw new Error("expected menu element");
    expect(menu.style.top).toBe(`${800 - 120 - MARGIN}px`);
    expect(menu.style.maxHeight).toBe("");
    rect.mockRestore();
  });

  it("clamps left with min-width when the first measure is 0×0", () => {
    const rect = mockMenuRect({ width: 0, height: 0 });
    stubViewport(1000, 800);

    render(
      <ContextMenu
        open
        position={{ x: 980, y: 10 }}
        groups={groups}
        onClose={() => {}}
      />,
    );

    const menu = document.querySelector(".context-menu");
    if (!(menu instanceof HTMLElement)) throw new Error("expected menu element");
    expect(menu.style.left).toBe(`${1000 - CONTEXT_MENU_MIN_WIDTH - MARGIN}px`);
    expect(menu.style.top).toBe("10px");
    rect.mockRestore();
  });
});
