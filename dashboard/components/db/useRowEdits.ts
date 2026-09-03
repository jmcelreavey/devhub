"use client";

import { useCallback, useMemo, useState } from "react";
import type { DbResultSet } from "@/lib/db/types";
import type { DbRowIdentityInfo } from "./shared";

/**
 * The staged edit buffer.
 *
 * Edits accumulate here and reach the database only when the user presses
 * Apply — the TablePlus model, and the right one: a grid where blur commits is
 * a grid where a stray tab key writes to production.
 *
 * Kept out of the grid component so the buffer survives re-renders, sorting and
 * the row-detail panel, and so it can be tested without mounting a table.
 */

export interface StagedEdit {
  rowIndex: number;
  column: string;
  original: unknown;
  value: unknown;
}

const editKey = (rowIndex: number, column: string) => `${rowIndex}:${column}`;

export function useRowEdits(result: DbResultSet | undefined, identity: DbRowIdentityInfo | null) {
  const [edits, setEdits] = useState<Map<string, StagedEdit>>(() => new Map());
  const [deletedRows, setDeletedRows] = useState<Set<number>>(() => new Set());

  /**
   * Discard the buffer whenever the rows change underneath it.
   *
   * Edits are keyed by *row index*, which is positional — so after a sort or a
   * re-run, a staged edit on row 0 would target whatever now sits at row 0.
   * Applying a change to a row the user never touched is the worst outcome a
   * grid editor has, and it would look like it worked.
   *
   * Tracked against the result object's identity rather than a deep compare:
   * every path that produces new rows produces a new object, and comparing
   * 50,000 rows on every render to answer a question object identity already
   * answers would be its own bug.
   */
  const [seenResult, setSeenResult] = useState(result);
  if (seenResult !== result) {
    // A render-phase reset, which is React's documented way to adjust state
    // when a prop changes — an effect would apply the stale buffer for one
    // render first, which is exactly the frame an Apply could land in.
    setSeenResult(result);
    if (edits.size > 0) setEdits(new Map());
    if (deletedRows.size > 0) setDeletedRows(new Set());
  }

  const reset = useCallback(() => {
    setEdits(new Map());
    setDeletedRows(new Set());
  }, []);

  const stage = useCallback((rowIndex: number, column: string, original: unknown, value: unknown) => {
    setEdits((prev) => {
      const next = new Map(prev);
      const key = editKey(rowIndex, column);
      // Typing a value back to what it was is not an edit. Without this, Apply
      // would fire an UPDATE that changes nothing and still risks failing the
      // optimistic lock.
      if (Object.is(original, value)) next.delete(key);
      else next.set(key, { rowIndex, column, original, value });
      return next;
    });
  }, []);

  const revertCell = useCallback((rowIndex: number, column: string) => {
    setEdits((prev) => {
      const next = new Map(prev);
      next.delete(editKey(rowIndex, column));
      return next;
    });
  }, []);

  const toggleDelete = useCallback((rowIndex: number) => {
    setDeletedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  }, []);

  const editedValue = useCallback(
    (rowIndex: number, column: string) => edits.get(editKey(rowIndex, column)),
    [edits],
  );

  /**
   * Turn the buffer into the request body.
   *
   * Identity values come from the row **as fetched**, not as edited — the WHERE
   * clause has to target where the row is now, even when the user is editing
   * one of the key columns.
   */
  const payload = useMemo(() => {
    if (!result || !identity) return { updates: [], deletes: [] };

    const columnIndex = new Map(result.columns.map((c, i) => [c.name, i]));
    const keyFor = (rowIndex: number) => {
      const row = result.rows[rowIndex];
      const key: Record<string, unknown> = {};
      for (const column of identity.columns) {
        const index = columnIndex.get(column);
        // A hidden identity (ctid/rowid) is not in the result set, so its value
        // is unavailable and the row cannot be targeted from here.
        if (index !== undefined) key[column] = row?.[index];
      }
      return key;
    };

    const byRow = new Map<number, Record<string, unknown>>();
    for (const edit of edits.values()) {
      if (deletedRows.has(edit.rowIndex)) continue;
      const bucket = byRow.get(edit.rowIndex) ?? {};
      bucket[edit.column] = edit.value;
      byRow.set(edit.rowIndex, bucket);
    }

    return {
      updates: [...byRow.entries()].map(([rowIndex, changes]) => ({
        rowIndex,
        key: keyFor(rowIndex),
        changes,
      })),
      deletes: [...deletedRows].map((rowIndex) => ({ key: keyFor(rowIndex) })),
    };
  }, [result, identity, edits, deletedRows]);

  /**
   * A hidden identity cannot be staged from the grid.
   *
   * `ctid` and `rowid` are not in the result set, so there is no value to build
   * a WHERE from. Saying that plainly beats letting someone edit six cells and
   * fail at Apply.
   */
  const blocked = useMemo(() => {
    if (!identity) return "This table has no usable row identity.";
    if (identity.hidden) {
      return `Rows here are identified by ${identity.columns.join(", ")}, which is not part of the result. Add a primary key, or select it explicitly, to edit from the grid.`;
    }
    return null;
  }, [identity]);

  return {
    edits,
    deletedRows,
    stage,
    revertCell,
    toggleDelete,
    editedValue,
    reset,
    payload,
    blocked,
    dirty: edits.size > 0 || deletedRows.size > 0,
    count: edits.size + deletedRows.size,
  };
}
