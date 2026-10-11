/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { GridLayout, noCompactor, type EventCallback } from "react-grid-layout";
import { ResizeHandle } from "./ResizeHandle";
import { RESIZE_AXES, startDragResize } from "@/lib/drag-resize";

describe("ResizeHandle", () => {
  it.each([
    ["n", "row-resize"], ["e", "col-resize"], ["s", "row-resize"], ["w", "col-resize"],
    ["ne", "nesw-resize"], ["se", "nwse-resize"], ["sw", "nesw-resize"], ["nw", "nwse-resize"],
  ] as const)("provides a %s hit target with the correct cursor", (axis, cursor) => {
    const onMouseDown = vi.fn();
    const { container } = render(<ResizeHandle axis={axis} positioned onMouseDown={onMouseDown} />);
    const handle = container.firstElementChild as HTMLElement;
    expect(handle.style.cursor).toBe(cursor);
    expect(handle.style.position).toBe("absolute");
    fireEvent.mouseDown(handle, { button: 0 });
    expect(onMouseDown).toHaveBeenCalledOnce();
  });

  it.each(RESIZE_AXES)("resizes a grid card from %s without starting a card drag", (axis) => {
    const onResize = vi.fn<EventCallback>();
    const onDragStart = vi.fn();
    const { container } = render(
      <GridLayout
        width={1200}
        gridConfig={{ cols: 12, rowHeight: 30, margin: [0, 0] }}
        layout={[{ i: "card", x: 2, y: 2, w: 4, h: 4 }]}
        compactor={noCompactor}
        dragConfig={{ cancel: ".today-grid-drag-cancel" }}
        resizeConfig={{
          handles: [...RESIZE_AXES],
          handleComponent: (direction, ref) => (
            <ResizeHandle axis={direction} positioned className="today-grid-drag-cancel" ref={ref as React.Ref<HTMLDivElement>} />
          ),
        }}
        onResize={onResize}
        onDragStart={onDragStart}
      >
        <div key="card">Card content</div>
      </GridLayout>,
    );
    const handle = container.querySelector<HTMLElement>(`[data-resize-axis="${axis}"]`)!;
    fireEvent.mouseDown(handle, { button: 0, clientX: 600, clientY: 300 });
    fireEvent.mouseMove(document, { clientX: 700, clientY: 330 });
    fireEvent.mouseUp(document);
    expect(onResize).toHaveBeenCalled();
    const resized = onResize.mock.lastCall![2]!;
    expect(resized.w).toBe(axis.includes("w") ? 3 : axis.includes("e") ? 5 : 4);
    expect(resized.h).toBe(axis.includes("n") ? 3 : axis.includes("s") ? 5 : 4);
    expect(onDragStart).not.toHaveBeenCalled();
  });

  it("gives corners priority without covering the titlebar interior", () => {
    const { container } = render(<>{RESIZE_AXES.map((axis) => <ResizeHandle key={axis} axis={axis} positioned />)}</>);
    const north = container.querySelector<HTMLElement>('[data-resize-axis="n"]')!;
    const corner = container.querySelector<HTMLElement>('[data-resize-axis="nw"]')!;
    expect(north.style.height).toBe("6px");
    expect(north.style.left).toBe("12px");
    expect(north.style.right).toBe("12px");
    expect(corner.style.width).toBe("12px");
    expect(corner.style.height).toBe("12px");
    expect(Number(corner.style.zIndex)).toBeGreaterThan(Number(north.style.zIndex));
  });
});

describe("resize drag shield", () => {
  it("tracks across child content, then removes listeners and the shield on mouseup", () => {
    const onMove = vi.fn();
    const onDone = vi.fn();
    const stop = startDragResize({ cursor: "nwse-resize", onMove, onDone });
    const shield = document.body.lastElementChild!;
    fireEvent.mouseMove(shield, { clientX: 500, clientY: 400 });
    expect(onMove).toHaveBeenCalledOnce();
    fireEvent.mouseUp(shield);
    expect(shield.isConnected).toBe(false);
    fireEvent.mouseMove(document);
    stop();
    expect(onMove).toHaveBeenCalledOnce();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("cleans up when focus leaves the app during a drag", () => {
    const onDone = vi.fn();
    const stop = startDragResize({ cursor: "col-resize", onMove: vi.fn(), onDone });
    const shield = document.body.lastElementChild!;
    fireEvent.blur(window);
    stop();
    expect(shield.isConnected).toBe(false);
    expect(onDone).toHaveBeenCalledOnce();
  });
});
