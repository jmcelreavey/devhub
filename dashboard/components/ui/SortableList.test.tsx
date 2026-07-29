/** @vitest-environment jsdom */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SortableList } from "@/components/ui/SortableList";

function Harness({ onReorder }: { onReorder?: (ids: string[]) => void }) {
  const [items, setItems] = useState([
    { id: "a", label: "Alpha" },
    { id: "b", label: "Bravo" },
    { id: "c", label: "Charlie" },
  ]);

  return (
    <SortableList
      items={items}
      getId={(item) => item.id}
      onReorder={(next) => {
        setItems(next);
        onReorder?.(next.map((item) => item.id));
      }}
      renderItem={(item, { dragHandleProps, isDragging, isDropTarget }) => (
        <div data-testid={`row-${item.id}`} data-dragging={isDragging || undefined} data-drop={isDropTarget || undefined}>
          <button type="button" aria-label={`Drag ${item.label}`} {...dragHandleProps}>
            grip
          </button>
          <span>{item.label}</span>
        </div>
      )}
    />
  );
}

function rowOrder(): string[] {
  return screen.getAllByTestId(/row-/).map((el) => el.getAttribute("data-testid")!.replace("row-", ""));
}

/** Points `elementFromPoint` at a given row, since jsdom has no layout. */
function pointAt(id: string | null) {
  document.elementFromPoint = () =>
    id === null ? document.body : screen.getByTestId(`row-${id}`);
}

function grip(label: string) {
  const el = screen.getByLabelText(`Drag ${label}`) as HTMLButtonElement & {
    setPointerCapture: (id: number) => void;
  };
  el.setPointerCapture = vi.fn();
  el.releasePointerCapture = vi.fn();
  return el;
}

/** Past the click/drag threshold. */
const FAR = { pointerId: 1, clientX: 0, clientY: 40, button: 0 };
const ORIGIN = { pointerId: 1, clientX: 0, clientY: 0, button: 0 };

beforeEach(() => {
  document.elementFromPoint = () => document.body;
});

describe("SortableList", () => {
  it("shifts siblings while dragging and commits on pointer up", () => {
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);
    const handle = grip("Alpha");

    act(() => {
      fireEvent.pointerDown(handle, ORIGIN);
    });

    pointAt("b");
    act(() => {
      fireEvent.pointerMove(handle, FAR);
    });

    expect(rowOrder()).toEqual(["b", "a", "c"]);
    expect(onReorder).not.toHaveBeenCalled();

    act(() => {
      fireEvent.pointerUp(handle, FAR);
    });

    expect(onReorder).toHaveBeenCalledWith(["b", "a", "c"]);
    expect(rowOrder()).toEqual(["b", "a", "c"]);
  });

  it("marks the dragged row while the gesture is live", () => {
    render(<Harness />);
    const handle = grip("Alpha");

    act(() => {
      fireEvent.pointerDown(handle, ORIGIN);
    });
    pointAt("b");
    act(() => {
      fireEvent.pointerMove(handle, FAR);
    });

    expect(screen.getByTestId("row-a").getAttribute("data-dragging")).toBe("true");
  });

  it("commits the latest preview when move and release share one render", () => {
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);
    const handle = grip("Alpha");
    pointAt("b");

    act(() => {
      fireEvent.pointerDown(handle, ORIGIN);
      fireEvent.pointerMove(handle, FAR);
      fireEvent.pointerUp(handle, FAR);
    });

    expect(onReorder).toHaveBeenCalledWith(["b", "a", "c"]);
  });

  it("treats a press without movement as a click, not a drag", () => {
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);
    const handle = grip("Alpha");

    act(() => {
      fireEvent.pointerDown(handle, ORIGIN);
    });
    pointAt("b");
    // Inside the threshold — must not start a drag.
    act(() => {
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 1, clientY: 1, button: 0 });
    });
    expect(rowOrder()).toEqual(["a", "b", "c"]);

    act(() => {
      fireEvent.pointerUp(handle, { pointerId: 1, clientX: 1, clientY: 1, button: 0 });
    });

    expect(onReorder).not.toHaveBeenCalled();
    expect(rowOrder()).toEqual(["a", "b", "c"]);
  });

  it("reverts the preview when the drag is cancelled", () => {
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);
    const handle = grip("Alpha");

    act(() => {
      fireEvent.pointerDown(handle, ORIGIN);
    });
    pointAt("c");
    act(() => {
      fireEvent.pointerMove(handle, FAR);
    });
    expect(rowOrder()).toEqual(["b", "c", "a"]);

    act(() => {
      fireEvent.pointerCancel(handle, FAR);
    });

    expect(onReorder).not.toHaveBeenCalled();
    expect(rowOrder()).toEqual(["a", "b", "c"]);
  });

  /*
   * The regression that made reordering feel broken in the desktop app. The
   * live preview moves the dragged row's DOM node, which releases the pointer
   * capture the grip used to hold — so the drag killed itself the moment it
   * first succeeded, snapping the row back. Losing capture must now be a
   * non-event.
   */
  it("keeps dragging after the grip's node moves and drops capture", () => {
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);
    const handle = grip("Alpha");

    act(() => {
      fireEvent.pointerDown(handle, ORIGIN);
    });
    pointAt("b");
    act(() => {
      fireEvent.pointerMove(handle, FAR);
    });
    expect(rowOrder()).toEqual(["b", "a", "c"]);

    act(() => {
      fireEvent.lostPointerCapture(handle, FAR);
    });
    expect(rowOrder()).toEqual(["b", "a", "c"]);

    // Still live: a further move keeps reordering.
    pointAt("c");
    act(() => {
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 0, clientY: 80, button: 0 });
    });
    expect(rowOrder()).toEqual(["b", "c", "a"]);

    act(() => {
      fireEvent.pointerUp(handle, { pointerId: 1, clientX: 0, clientY: 80, button: 0 });
    });
    expect(onReorder).toHaveBeenCalledWith(["b", "c", "a"]);
  });

  it("reorders through a pointer released outside the list", () => {
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);
    const handle = grip("Alpha");

    act(() => {
      fireEvent.pointerDown(handle, ORIGIN);
    });
    pointAt("b");
    act(() => {
      fireEvent.pointerMove(window, FAR);
    });
    expect(rowOrder()).toEqual(["b", "a", "c"]);

    // Release over nothing in particular — the window still owns the gesture.
    pointAt(null);
    act(() => {
      fireEvent.pointerUp(window, FAR);
    });

    expect(onReorder).toHaveBeenCalledWith(["b", "a", "c"]);
  });

  it("reverts the preview when Escape aborts the drag", () => {
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);
    const handle = grip("Alpha");

    act(() => {
      fireEvent.pointerDown(handle, ORIGIN);
    });
    pointAt("c");
    act(() => {
      fireEvent.pointerMove(handle, FAR);
    });
    expect(rowOrder()).toEqual(["b", "c", "a"]);

    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    expect(onReorder).not.toHaveBeenCalled();
    expect(rowOrder()).toEqual(["a", "b", "c"]);
  });

  it("reorders with arrow keys without a drag session", () => {
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);

    act(() => {
      fireEvent.keyDown(screen.getByLabelText("Drag Alpha"), { key: "ArrowDown" });
    });

    expect(onReorder).toHaveBeenCalledWith(["b", "a", "c"]);
  });

  it("does nothing when disabled", () => {
    const onReorder = vi.fn();
    render(
      <SortableList
        items={[{ id: "a" }, { id: "b" }]}
        getId={(item) => item.id}
        disabled
        onReorder={onReorder}
        renderItem={(item, { dragHandleProps }) => (
          <div data-testid={`row-${item.id}`}>
            <button type="button" aria-label={`Drag ${item.id}`} {...dragHandleProps}>
              grip
            </button>
          </div>
        )}
      />,
    );

    act(() => {
      fireEvent.keyDown(screen.getByLabelText("Drag a"), { key: "ArrowDown" });
    });
    expect(onReorder).not.toHaveBeenCalled();
  });
});
