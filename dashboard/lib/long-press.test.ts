/** @vitest-environment jsdom */
import { act, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ROW_LONG_PRESS_MOVE_PX,
  ROW_LONG_PRESS_MS,
  createLongPressBind,
  type LongPressOptions,
  type LongPressPoint,
  type LongPressRefs,
} from "./long-press";

function mountRow(opts: LongPressOptions) {
  const refs: LongPressRefs = { press: { current: null }, suppressClick: { current: false } };
  const bind = createLongPressBind(opts, refs);
  const row = document.createElement("button");
  row.addEventListener("pointerdown", (e) => bind.onPointerDown(e as never));
  row.addEventListener("pointermove", (e) => bind.onPointerMove(e as never));
  row.addEventListener("pointerup", (e) => bind.onPointerUp(e as never));
  row.addEventListener("pointercancel", (e) => bind.onPointerCancel(e as never));
  row.addEventListener("click", (e) => bind.onClick(e as never));
  document.body.appendChild(row);
  return { row, refs };
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("createLongPressBind", () => {
  it("fires onLongPress after a touch hold", () => {
    vi.useFakeTimers();
    const onTap = vi.fn();
    const onLongPress = vi.fn();
    const { row } = mountRow({ onTap, onLongPress });

    fireEvent.pointerDown(row, { pointerType: "touch", pointerId: 1, clientX: 20, clientY: 30 });
    expect(onLongPress).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(ROW_LONG_PRESS_MS);
    });

    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(onTap).not.toHaveBeenCalled();
  });

  it("hands the press point and host to onLongPress so menus can anchor", () => {
    vi.useFakeTimers();
    let point: LongPressPoint | null = null;
    const { row } = mountRow({ onLongPress: (p) => (point = p) });

    fireEvent.pointerDown(row, { pointerType: "touch", pointerId: 1, clientX: 20, clientY: 30 });
    act(() => {
      vi.advanceTimersByTime(ROW_LONG_PRESS_MS);
    });

    expect(point).toMatchObject({ x: 20, y: 30, host: row });
  });

  it("fires onTap on a short touch tap", () => {
    const onTap = vi.fn();
    const onLongPress = vi.fn();
    const { row } = mountRow({ onTap, onLongPress });

    fireEvent.pointerDown(row, { pointerType: "touch", pointerId: 2, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(row, { pointerType: "touch", pointerId: 2 });
    fireEvent.click(row);

    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("ignores pointerdown from mouse — right-click and Shift-click already cover it", () => {
    vi.useFakeTimers();
    const onTap = vi.fn();
    const onLongPress = vi.fn();
    const { row } = mountRow({ onTap, onLongPress });

    fireEvent.pointerDown(row, { pointerType: "mouse", pointerId: 3, clientX: 0, clientY: 0 });
    act(() => {
      vi.advanceTimersByTime(ROW_LONG_PRESS_MS);
    });
    fireEvent.click(row);

    expect(onLongPress).not.toHaveBeenCalled();
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  /** A drag past the slop is a scroll, not a press. */
  it("cancels once the finger moves past the movement threshold", () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const { row } = mountRow({ onLongPress });

    fireEvent.pointerDown(row, { pointerType: "touch", pointerId: 4, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(row, {
      pointerId: 4,
      clientX: 10 + ROW_LONG_PRESS_MOVE_PX + 1,
      clientY: 10,
    });
    act(() => {
      vi.advanceTimersByTime(ROW_LONG_PRESS_MS);
    });

    expect(onLongPress).not.toHaveBeenCalled();
  });

  /** The click that trails a long-press must not also run the tap action. */
  it("swallows the click that follows a long-press, then re-arms", () => {
    vi.useFakeTimers();
    const onTap = vi.fn();
    const onLongPress = vi.fn();
    const { row } = mountRow({ onTap, onLongPress });

    fireEvent.pointerDown(row, { pointerType: "touch", pointerId: 5, clientX: 10, clientY: 10 });
    act(() => {
      vi.advanceTimersByTime(ROW_LONG_PRESS_MS);
    });
    fireEvent.pointerUp(row, { pointerType: "touch", pointerId: 5 });
    fireEvent.click(row);
    expect(onTap).not.toHaveBeenCalled();

    fireEvent.pointerDown(row, { pointerType: "touch", pointerId: 6, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(row, { pointerType: "touch", pointerId: 6 });
    fireEvent.click(row);
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("does not stop propagation unless asked", () => {
    const bare = mountRow({ onLongPress: vi.fn() });
    const stopping = mountRow({ onLongPress: vi.fn(), stopPropagation: true });
    const seen: string[] = [];
    document.body.addEventListener("pointerdown", () => seen.push("bubbled"));

    fireEvent.pointerDown(bare.row, { pointerType: "touch", pointerId: 7, clientX: 0, clientY: 0 });
    expect(seen).toEqual(["bubbled"]);

    fireEvent.pointerDown(stopping.row, {
      pointerType: "touch",
      pointerId: 8,
      clientX: 0,
      clientY: 0,
    });
    expect(seen).toEqual(["bubbled"]);
  });
});
