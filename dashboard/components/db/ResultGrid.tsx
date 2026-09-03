"use client";

import { useCallback, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Eye, X } from "lucide-react";
import { useVirtualRows } from "@/lib/hooks/use-virtual-rows";
import { EmptyState } from "@/components/ui/EmptyState";
import { ContextMenu, type ContextMenuGroup } from "@/components/shell/ContextMenu";
import { CopyButton } from "@/components/ui/CopyButton";
import type { DbColumn, DbResultSet } from "@/lib/db/types";
import { cellMenuGroups, columnMenuGroups } from "./menus";

/** Row height must be fixed and match the CSS, or the windowing maths drifts. */
const ROW_HEIGHT = 30;

export interface GridSort {
  column: string;
  direction: "asc" | "desc";
}

interface ResultGridProps {
  result: DbResultSet;
  engine: string;
  /** Table in view, for INSERT generation and relation-aware menu entries. */
  table?: { namespace: string; name: string } | null;
  /** Server-side sort — re-runs the query with ORDER BY. */
  sort?: GridSort | null;
  onSort?: (sort: GridSort) => void;
  onFilterBy?: (clause: string) => void;
  onAskAi?: (prompt: string) => void;
  onCopy: (text: string, what: string) => void;
  canEdit?: boolean;
  editDisabledReason?: string;
  /** Staged-edit hooks. Absent means the grid is read-only. */
  editing?: {
    stage: (rowIndex: number, column: string, original: unknown, value: unknown) => void;
    revertCell: (rowIndex: number, column: string) => void;
    toggleDelete: (rowIndex: number) => void;
    editedValue: (rowIndex: number, column: string) => { value: unknown } | undefined;
    deletedRows: Set<number>;
  };
}

/**
 * The result table.
 *
 * Windowed via `useVirtualRows`, which exists for exactly this: a flat array of
 * equal-height rows. A 50k-row export renders the same twenty rows a 20-row
 * query does.
 *
 * Sorting is delegated upward rather than done here. Sorting only the rows that
 * came back would order the *page*, not the result — with a `LIMIT 200` on a
 * million-row table that is a different and much less useful answer than the
 * one the user expects, so the query re-runs with an ORDER BY instead.
 */
export function ResultGrid({
  result,
  engine,
  table,
  sort,
  onSort,
  onFilterBy,
  onAskAi,
  onCopy,
  canEdit,
  editDisabledReason,
  editing,
}: ResultGridProps) {
  const [selected, setSelected] = useState<{ row: number; column: number } | null>(null);
  /** The cell currently open for typing. Only ever one. */
  const [editingCell, setEditingCell] = useState<{ row: number; column: number } | null>(null);
  const [draft, setDraft] = useState("");
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [detailRow, setDetailRow] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; groups: ContextMenuGroup[] } | null>(null);

  const visible = useMemo(
    () =>
      result.columns
        .map((column, index) => ({ column, index }))
        .filter(({ column }) => !hidden.has(column.name)),
    [result.columns, hidden],
  );

  const { scrollRef, window: view } = useVirtualRows(result.rows.length, ROW_HEIGHT);
  const widths = useMemo(() => columnWidths(result, visible), [result, visible]);

  const openCellMenu = useCallback(
    (event: React.MouseEvent, rowIndex: number, columnIndex: number) => {
      event.preventDefault();
      setSelected({ row: rowIndex, column: columnIndex });
      setMenu({
        x: event.clientX,
        y: event.clientY,
        groups: cellMenuGroups(
          {
            value: result.rows[rowIndex]?.[columnIndex] ?? null,
            column: result.columns[columnIndex],
            row: result.rows[rowIndex] ?? [],
            columns: result.columns,
            engine,
            table,
          },
          {
            onCopy,
            onFilterBy: (clause) => onFilterBy?.(clause),
            onAskAi: (prompt) => onAskAi?.(prompt),
            canEdit: Boolean(canEdit && editing),
            editDisabledReason,
            onEdit: editing
              ? () => {
                  setEditingCell({ row: rowIndex, column: columnIndex });
                  const current = result.rows[rowIndex]?.[columnIndex];
                  setDraft(current === null || current === undefined ? "" : String(current));
                }
              : undefined,
            onSetNull: editing
              ? () =>
                  editing.stage(
                    rowIndex,
                    result.columns[columnIndex].name,
                    result.rows[rowIndex]?.[columnIndex] ?? null,
                    null,
                  )
              : undefined,
          },
        ),
      });
    },
    [result, engine, table, onCopy, onFilterBy, onAskAi, canEdit, editDisabledReason, editing],
  );

  const openColumnMenu = useCallback(
    (event: React.MouseEvent, column: DbColumn) => {
      event.preventDefault();
      setMenu({
        x: event.clientX,
        y: event.clientY,
        groups: columnMenuGroups(column, table, engine, {
          onSort: (name, direction) => onSort?.({ column: name, direction }),
          onCopy,
          onHide: (name) => setHidden((prev) => new Set(prev).add(name)),
          onAskAi: (prompt) => onAskAi?.(prompt),
        }),
      });
    },
    [table, engine, onSort, onCopy, onAskAi],
  );

  if (result.columns.length === 0) {
    return (
      <EmptyState
        title="No columns"
        subtitle={
          result.rowsAffected !== undefined
            ? `${result.rowsAffected} row${result.rowsAffected === 1 ? "" : "s"} affected.`
            : "The statement returned no result set."
        }
        bare
      />
    );
  }

  return (
    <>
      {hidden.size > 0 && (
        <div className="db-grid-hidden-bar">
          <span>
            {hidden.size} column{hidden.size === 1 ? "" : "s"} hidden
          </span>
          <button type="button" className="btn btn-ghost" onClick={() => setHidden(new Set())}>
            <Eye size={12} aria-hidden /> Show all
          </button>
        </div>
      )}

      <div className="db-grid" ref={scrollRef}>
        <table className="db-grid-table" style={{ minWidth: widths.total }}>
          <thead>
            <tr>
              <th className="db-grid-gutter" scope="col">
                <span className="sr-only">Row number</span>
              </th>
              {visible.map(({ column, index }, position) => (
                <th
                  key={`${column.name}-${index}`}
                  scope="col"
                  style={{ width: widths.columns[position] }}
                  onContextMenu={(e) => openColumnMenu(e, column)}
                  aria-sort={
                    sort?.column === column.name
                      ? sort.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                >
                  <button
                    type="button"
                    className="db-grid-column-button"
                    onClick={() =>
                      onSort?.({
                        column: column.name,
                        direction:
                          sort?.column === column.name && sort.direction === "asc" ? "desc" : "asc",
                      })
                    }
                    disabled={!onSort}
                  >
                    <span className="db-grid-column-name">
                      {column.name}
                      {sort?.column === column.name &&
                        (sort.direction === "asc" ? (
                          <ArrowUp size={11} aria-hidden />
                        ) : (
                          <ArrowDown size={11} aria-hidden />
                        ))}
                    </span>
                    {column.dataType && <span className="db-grid-column-type">{column.dataType}</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.padTop > 0 && (
              <tr aria-hidden style={{ height: view.padTop }}>
                <td colSpan={visible.length + 1} />
              </tr>
            )}

            {result.rows.slice(view.start, view.end).map((row, offset) => {
              const rowIndex = view.start + offset;
              const deleted = editing?.deletedRows.has(rowIndex) ?? false;
              return (
                <tr key={rowIndex} style={{ height: ROW_HEIGHT }} className={deleted ? "is-deleted" : undefined}>
                  <td className="db-grid-gutter">
                    <button
                      type="button"
                      className="db-grid-row-button"
                      onClick={() => setDetailRow(rowIndex)}
                      onContextMenu={(e) => {
                        if (!editing || !canEdit) return;
                        e.preventDefault();
                        editing.toggleDelete(rowIndex);
                      }}
                      title={
                        editing && canEdit
                          ? "Open row · right-click to stage a delete"
                          : "Open row"
                      }
                      aria-label={`Open row ${rowIndex + 1}`}
                    >
                      {rowIndex + 1}
                    </button>
                  </td>
                  {visible.map(({ column, index: columnIndex }) => {
                    const original = row[columnIndex];
                    const staged = editing?.editedValue(rowIndex, column.name);
                    const value = staged ? staged.value : original;
                    const isSelected =
                      selected?.row === rowIndex && selected?.column === columnIndex;
                    const isEditing =
                      editingCell?.row === rowIndex && editingCell?.column === columnIndex;

                    const commit = () => {
                      setEditingCell(null);
                      if (!editing) return;
                      // An empty box means empty string, not NULL — "Set NULL"
                      // in the context menu is how you mean NULL, because the
                      // two are different and guessing would be worse.
                      editing.stage(rowIndex, column.name, original, draft);
                    };

                    return (
                      <td
                        key={columnIndex}
                        className={[
                          "db-grid-cell",
                          isSelected ? "is-selected" : "",
                          staged ? "is-edited" : "",
                          deleted ? "is-deleted" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={() => setSelected({ row: rowIndex, column: columnIndex })}
                        onDoubleClick={() => {
                          if (!editing || !canEdit) {
                            setDetailRow(rowIndex);
                            return;
                          }
                          setEditingCell({ row: rowIndex, column: columnIndex });
                          setDraft(value === null || value === undefined ? "" : String(value));
                        }}
                        onContextMenu={(e) => openCellMenu(e, rowIndex, columnIndex)}
                        title={
                          staged
                            ? `Was: ${original === null ? "NULL" : String(original)}`
                            : value === null
                              ? "NULL"
                              : String(value)
                        }
                      >
                        {isEditing ? (
                          <input
                            className="db-grid-input"
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onBlur={commit}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commit();
                              // Escape abandons the edit rather than staging it.
                              if (e.key === "Escape") setEditingCell(null);
                            }}
                            autoFocus
                          />
                        ) : value === null ? (
                          /* NULL and '' are visually identical and mean very
                             different things when you are debugging. */
                          <span className="db-grid-null">NULL</span>
                        ) : (
                          String(value)
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            {view.padBottom > 0 && (
              <tr aria-hidden style={{ height: view.padBottom }}>
                <td colSpan={visible.length + 1} />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ContextMenu
        open={menu !== null}
        position={menu}
        groups={menu?.groups ?? []}
        onClose={() => setMenu(null)}
        label="Result actions"
      />

      {detailRow !== null && result.rows[detailRow] && (
        <RowDetail
          columns={result.columns}
          row={result.rows[detailRow]}
          index={detailRow}
          onClose={() => setDetailRow(null)}
        />
      )}
    </>
  );
}

/**
 * One row, vertically.
 *
 * The escape hatch for the two cases a grid handles badly: a table with sixty
 * columns, and a Mongo document whose interesting field is a nested blob three
 * cells to the right of where you can see.
 */
function RowDetail({
  columns,
  row,
  index,
  onClose,
}: {
  columns: DbColumn[];
  row: unknown[];
  index: number;
  onClose: () => void;
}) {
  const asJson = useMemo(
    () =>
      JSON.stringify(
        Object.fromEntries(columns.map((c, i) => [c.name, row[i] ?? null])),
        null,
        2,
      ),
    [columns, row],
  );

  return (
    <aside className="db-row-detail" aria-label={`Row ${index + 1}`}>
      <header className="db-row-detail-head">
        <h3>Row {index + 1}</h3>
        <div className="db-row-detail-actions">
          <CopyButton text={asJson} label="Copy as JSON" />
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close row">
            <X size={14} />
          </button>
        </div>
      </header>
      <dl className="db-row-detail-list">
        {columns.map((column, i) => (
          <div key={column.name + i} className="db-row-detail-field">
            <dt>
              {column.name}
              {column.dataType && <span className="db-row-detail-type">{column.dataType}</span>}
            </dt>
            <dd className={row[i] === null ? "is-null" : undefined}>
              {row[i] === null ? "NULL" : String(row[i])}
            </dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

/**
 * Size columns from the widest of the first few rows.
 *
 * Sampled rather than measured across every row: with windowing, most rows are
 * never rendered, and walking 50k of them to pick a width would undo the point
 * of not rendering them.
 */
function columnWidths(
  result: DbResultSet,
  visible: { column: DbColumn; index: number }[],
): { columns: number[]; total: number } {
  const SAMPLE = 50;
  const MIN = 90;
  const MAX = 420;
  const CHAR = 7.4;

  const columns = visible.map(({ column, index }) => {
    let widest = column.name.length + (column.dataType?.length ?? 0) / 2;
    for (let row = 0; row < Math.min(SAMPLE, result.rows.length); row++) {
      const value = result.rows[row][index];
      const length = value === null ? 4 : String(value).length;
      if (length > widest) widest = length;
    }
    return Math.max(MIN, Math.min(MAX, Math.ceil(widest * CHAR) + 24));
  });

  return { columns, total: columns.reduce((sum, w) => sum + w, 48) };
}
