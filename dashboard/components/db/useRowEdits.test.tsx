/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useRowEdits } from "./useRowEdits";
import type { DbResultSet } from "@/lib/db/types";
import type { DbRowIdentityInfo } from "./shared";

const pk: DbRowIdentityInfo = {
  columns: ["id"],
  source: "primary-key",
  hidden: false,
  description: "Rows identified by primary key (id).",
};

const result = (rows: unknown[][]): DbResultSet => ({
  columns: [{ name: "id" }, { name: "title" }, { name: "views" }],
  rows,
  truncated: false,
  durationMs: 1,
  statement: "SELECT id, title, views FROM posts",
});

const base = result([
  [1, "first", 10],
  [2, "second", 20],
]);

describe("staging", () => {
  it("stages a change and reports it as dirty", () => {
    const { result: hook } = renderHook(() => useRowEdits(base, pk));
    act(() => hook.current.stage(0, "title", "first", "edited"));
    expect(hook.current.dirty).toBe(true);
    expect(hook.current.count).toBe(1);
    expect(hook.current.payload.updates).toEqual([
      { rowIndex: 0, key: { id: 1 }, changes: { title: "edited" } },
    ]);
  });

  /** Typing a value back to what it was is not an edit. */
  it("drops an edit that returns the original value", () => {
    const { result: hook } = renderHook(() => useRowEdits(base, pk));
    act(() => hook.current.stage(0, "title", "first", "edited"));
    act(() => hook.current.stage(0, "title", "first", "first"));
    expect(hook.current.dirty).toBe(false);
    expect(hook.current.payload.updates).toEqual([]);
  });

  it("collects several columns of one row into a single update", () => {
    const { result: hook } = renderHook(() => useRowEdits(base, pk));
    act(() => hook.current.stage(0, "title", "first", "a"));
    act(() => hook.current.stage(0, "views", 10, 99));
    expect(hook.current.payload.updates).toHaveLength(1);
    expect(hook.current.payload.updates[0].changes).toEqual({ title: "a", views: 99 });
  });

  it("stages a NULL distinctly from an empty string", () => {
    const { result: hook } = renderHook(() => useRowEdits(base, pk));
    act(() => hook.current.stage(0, "title", "first", null));
    expect(hook.current.payload.updates[0].changes).toEqual({ title: null });
  });

  /** The identity comes from the row as fetched, even while editing the key. */
  it("keys the update on the original id when the id itself is edited", () => {
    const { result: hook } = renderHook(() => useRowEdits(base, pk));
    act(() => hook.current.stage(0, "id", 1, 77));
    expect(hook.current.payload.updates[0]).toEqual({
      rowIndex: 0,
      key: { id: 1 },
      changes: { id: 77 },
    });
  });
});

describe("deletes", () => {
  it("stages and unstages a delete", () => {
    const { result: hook } = renderHook(() => useRowEdits(base, pk));
    act(() => hook.current.toggleDelete(1));
    expect(hook.current.payload.deletes).toEqual([{ key: { id: 2 } }]);
    act(() => hook.current.toggleDelete(1));
    expect(hook.current.payload.deletes).toEqual([]);
  });

  /** Updating a row you also deleted is a no-op the server would reject. */
  it("drops edits on a row that is also staged for deletion", () => {
    const { result: hook } = renderHook(() => useRowEdits(base, pk));
    act(() => hook.current.stage(0, "title", "first", "edited"));
    act(() => hook.current.toggleDelete(0));
    expect(hook.current.payload.updates).toEqual([]);
    expect(hook.current.payload.deletes).toEqual([{ key: { id: 1 } }]);
  });
});

describe("result changes", () => {
  /**
   * The bug this exists to prevent: row indexes are positional, so a staged
   * edit on row 0 would silently retarget whatever lands at row 0 after a sort
   * or a re-run. Applying an edit to a row the user never touched is the worst
   * possible outcome for a grid editor, so the buffer must not survive.
   */
  it("discards staged edits when the rows change underneath", () => {
    const { result: hook, rerender } = renderHook(
      ({ rows }: { rows: DbResultSet }) => useRowEdits(rows, pk),
      { initialProps: { rows: base } },
    );

    act(() => hook.current.stage(0, "title", "first", "edited"));
    expect(hook.current.dirty).toBe(true);

    // Same shape, different order — exactly what sorting produces.
    rerender({
      rows: result([
        [2, "second", 20],
        [1, "first", 10],
      ]),
    });

    expect(hook.current.dirty).toBe(false);
    expect(hook.current.payload.updates).toEqual([]);
  });

  it("keeps the buffer when the same result object re-renders", () => {
    const { result: hook, rerender } = renderHook(
      ({ rows }: { rows: DbResultSet }) => useRowEdits(rows, pk),
      { initialProps: { rows: base } },
    );
    act(() => hook.current.stage(0, "title", "first", "edited"));
    rerender({ rows: base });
    expect(hook.current.dirty).toBe(true);
  });
});

describe("blocked", () => {
  it("refuses when there is no identity", () => {
    const { result: hook } = renderHook(() => useRowEdits(base, null));
    expect(hook.current.blocked).toMatch(/no usable row identity/i);
  });

  /** ctid/rowid are not in the result, so there is no value to build a WHERE from. */
  it("refuses a hidden identity and names it", () => {
    const { result: hook } = renderHook(() =>
      useRowEdits(base, { ...pk, columns: ["ctid"], source: "rowid", hidden: true }),
    );
    expect(hook.current.blocked).toMatch(/ctid/);
  });

  it("allows a visible primary key", () => {
    const { result: hook } = renderHook(() => useRowEdits(base, pk));
    expect(hook.current.blocked).toBeNull();
  });
});
