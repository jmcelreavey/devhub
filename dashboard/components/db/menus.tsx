"use client";

import {
  ArrowDownAZ,
  ArrowUpAZ,
  Ban,
  Braces,
  Copy,
  Database,
  Download,
  Eraser,
  Filter,
  Hash,
  Link2,
  ListFilter,
  Pencil,
  Play,
  Plug,
  PlugZap,
  RefreshCw,
  Rows3,
  Sparkles,
  Table2,
  Terminal,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import type { ContextMenuGroup } from "@/components/shell/ContextMenu";
import { copyTextToClipboard } from "@/lib/clipboard";
import type { DbObjectSummary } from "@/lib/db/introspect-types";
import type { DbColumn } from "@/lib/db/types";
import type { DbConnectionRow, DbTablePayload } from "./shared";

/**
 * The right-click surface, in one place.
 *
 * Every desktop database client is really a set of context menus with a grid
 * attached — the menu is where "select the top 200 rows", "copy this as an
 * INSERT" and "filter by this value" live, and hunting for a toolbar button for
 * each is what makes a client feel slow.
 *
 * Menu *contents* live here as pure builders so they can be unit-tested without
 * mounting a grid, the same split `commitMenuGroups.tsx` uses for git.
 */

const icon = (Icon: typeof Copy) => <Icon size={13} strokeWidth={1.8} />;

/** Double-quoted identifier — correct for Postgres and SQLite alike. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function qualifiedName(engine: string, namespace: string, name: string): string {
  // SQLite has one namespace, so qualifying it is noise.
  return engine === "sqlite" ? quoteIdent(name) : `${quoteIdent(namespace)}.${quoteIdent(name)}`;
}

/**
 * A SQL literal for a filter clause or a copied INSERT.
 *
 * Matches `lib/db/export.ts`'s rendering deliberately — the same value must not
 * become `NULL` in an exported file and `'Infinity'` in a copied INSERT.
 * Non-finite numbers have no SQL literal, so NULL is the honest answer.
 */
export function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${String(value).replace(/'/g, "''")}'`;
}

/* ─── Connection rail ─── */

export interface ConnectionMenuActions {
  onOpen: (id: string) => void;
  onDisconnect: (id: string) => void;
  onRefresh: () => void;
  onEdit?: (connection: DbConnectionRow) => void;
  onDelete?: (connection: DbConnectionRow) => void;
  onOpenInTerminal?: (connection: DbConnectionRow) => void;
  onRemedy?: (connection: DbConnectionRow) => void;
  notify: (message: string) => void;
}

export function connectionMenuGroups(
  connection: DbConnectionRow,
  actions: ConnectionMenuActions,
): ContextMenuGroup[] {
  const isUser = connection.source === "user";

  const groups: ContextMenuGroup[] = [
    {
      id: "open",
      items: [
        {
          id: "open",
          label: connection.open ? "Focus" : "Connect",
          icon: icon(Plug),
          onSelect: () => actions.onOpen(connection.id),
        },
        {
          id: "disconnect",
          label: "Disconnect",
          description: "Close the pooled connection; it reopens on next use.",
          icon: icon(PlugZap),
          disabled: !connection.open,
          disabledReason: "not connected",
          onSelect: () => actions.onDisconnect(connection.id),
        },
      ],
    },
  ];

  if (connection.remedy && actions.onRemedy) {
    groups.push({
      id: "remedy",
      items: [
        {
          id: "remedy",
          label: connection.remedy.label,
          description: connection.unavailable,
          icon: icon(RefreshCw),
          onSelect: () => actions.onRemedy?.(connection),
        },
      ],
    });
  }

  groups.push({
    id: "copy",
    label: "Copy",
    items: [
      {
        id: "copy-id",
        label: "Copy connection id",
        icon: icon(Copy),
        onSelect: async () => {
          await copyTextToClipboard(connection.id);
          actions.notify("Connection id copied");
        },
      },
      {
        id: "copy-label",
        label: "Copy name",
        icon: icon(Copy),
        onSelect: async () => {
          await copyTextToClipboard(connection.label);
          actions.notify("Name copied");
        },
      },
    ],
  });

  const tail: ContextMenuGroup["items"] = [
    {
      id: "refresh",
      label: "Refresh connections",
      icon: icon(RefreshCw),
      onSelect: () => actions.onRefresh(),
    },
  ];

  if (actions.onOpenInTerminal) {
    tail.unshift({
      id: "terminal",
      label: connection.engine === "mongodb" ? "Open in mongosh" : "Open in psql",
      description: "Hand off to a terminal with credentials already set.",
      icon: icon(Terminal),
      onSelect: () => actions.onOpenInTerminal?.(connection),
    });
  }

  groups.push({ id: "tools", items: tail });

  if (isUser && (actions.onEdit || actions.onDelete)) {
    groups.push({
      id: "manage",
      items: [
        ...(actions.onEdit
          ? [
              {
                id: "edit",
                label: "Edit connection…",
                icon: icon(Pencil),
                onSelect: () => actions.onEdit?.(connection),
              },
            ]
          : []),
        ...(actions.onDelete
          ? [
              {
                id: "delete",
                label: "Remove connection",
                description: "Removes it from DevHub. The database is untouched.",
                icon: icon(Trash2),
                danger: true,
                onSelect: () => actions.onDelete?.(connection),
              },
            ]
          : []),
      ],
    });
  }

  return groups;
}

/* ─── Schema tree ─── */

export interface ObjectMenuActions {
  onRun: (sql: string) => void;
  onInsertIntoEditor: (sql: string) => void;
  onStructure: (object: DbObjectSummary) => void;
  onExport: (object: DbObjectSummary) => void;
  notify: (message: string) => void;
  /** Write statements go to the editor rather than running — never one-click. */
  canWrite: boolean;
}

export function objectMenuGroups(
  object: DbObjectSummary,
  engine: string,
  actions: ObjectMenuActions,
): ContextMenuGroup[] {
  const target = qualifiedName(engine, object.namespace, object.name);
  const isMongo = engine === "mongodb";
  const select = isMongo
    ? `db.${object.name}.find({}).limit(200)`
    : `SELECT * FROM ${target} LIMIT 200;`;

  return [
    {
      id: "view",
      items: [
        {
          id: "select-200",
          label: isMongo ? "Find first 200 documents" : "Select top 200 rows",
          icon: icon(Play),
          onSelect: () => actions.onRun(select),
        },
        {
          id: "count",
          label: "Count rows",
          icon: icon(Hash),
          onSelect: () =>
            actions.onRun(
              isMongo
                ? `db.${object.name}.countDocuments({})`
                : `SELECT count(*) AS row_count FROM ${target};`,
            ),
        },
        {
          id: "structure",
          label: "Show structure",
          icon: icon(Table2),
          onSelect: () => actions.onStructure(object),
        },
      ],
    },
    {
      id: "generate",
      label: "Insert into editor",
      items: [
        {
          id: "gen-select",
          label: "SELECT statement",
          icon: icon(Braces),
          onSelect: () => actions.onInsertIntoEditor(select),
        },
        {
          id: "gen-insert",
          label: "INSERT statement",
          icon: icon(Rows3),
          disabled: isMongo,
          disabledReason: "SQL only",
          onSelect: () =>
            actions.onInsertIntoEditor(`INSERT INTO ${target} (/* columns */)\nVALUES (/* values */);`),
        },
        {
          id: "gen-update",
          label: "UPDATE statement",
          icon: icon(Pencil),
          disabled: isMongo,
          disabledReason: "SQL only",
          onSelect: () =>
            actions.onInsertIntoEditor(`UPDATE ${target}\nSET /* column = value */\nWHERE /* condition */;`),
        },
        {
          id: "gen-delete",
          label: "DELETE statement",
          icon: icon(Eraser),
          disabled: isMongo,
          disabledReason: "SQL only",
          onSelect: () =>
            actions.onInsertIntoEditor(`DELETE FROM ${target}\nWHERE /* condition */;`),
        },
      ],
    },
    {
      id: "tools",
      items: [
        {
          id: "export",
          label: "Export rows…",
          icon: icon(Download),
          onSelect: () => actions.onExport(object),
        },
        {
          id: "copy-name",
          label: "Copy name",
          icon: icon(Copy),
          onSelect: async () => {
            await copyTextToClipboard(object.name);
            actions.notify("Name copied");
          },
        },
        {
          id: "copy-qualified",
          label: "Copy qualified name",
          icon: icon(Copy),
          onSelect: async () => {
            await copyTextToClipboard(target);
            actions.notify("Qualified name copied");
          },
        },
      ],
    },
    {
      id: "danger",
      items: [
        {
          id: "truncate",
          // Written to the editor, never run. A destructive statement should
          // cost a deliberate keystroke, and it still faces the write gate.
          label: "TRUNCATE — write to editor",
          description: "Puts the statement in the editor. It is not run.",
          icon: icon(Ban),
          danger: true,
          disabled: !actions.canWrite || isMongo,
          disabledReason: isMongo ? "SQL only" : "read-only connection",
          onSelect: () => actions.onInsertIntoEditor(`TRUNCATE TABLE ${target};`),
        },
        {
          id: "drop",
          label: "DROP — write to editor",
          description: "Puts the statement in the editor. It is not run.",
          icon: icon(Trash2),
          danger: true,
          disabled: !actions.canWrite,
          disabledReason: "read-only connection",
          onSelect: () =>
            actions.onInsertIntoEditor(
              isMongo ? `db.${object.name}.drop()` : `DROP TABLE ${target};`,
            ),
        },
      ],
    },
  ];
}

/* ─── Result grid ─── */

export interface CellMenuActions {
  onCopy: (text: string, what: string) => void;
  onFilterBy: (clause: string) => void;
  onAskAi: (prompt: string) => void;
  onEdit?: () => void;
  onSetNull?: () => void;
  canEdit: boolean;
  editDisabledReason?: string;
}

export interface CellContext {
  value: unknown;
  column: DbColumn;
  row: unknown[];
  columns: DbColumn[];
  engine: string;
  table?: { namespace: string; name: string } | null;
}

export function cellMenuGroups(cell: CellContext, actions: CellMenuActions): ContextMenuGroup[] {
  const asText = cell.value === null || cell.value === undefined ? "" : String(cell.value);
  const rowObject = Object.fromEntries(cell.columns.map((c, i) => [c.name, cell.row[i] ?? null]));
  const columnRef = quoteIdent(cell.column.name);
  const isMongo = cell.engine === "mongodb";

  const groups: ContextMenuGroup[] = [
    {
      id: "copy",
      label: "Copy",
      items: [
        {
          id: "copy-cell",
          label: cell.value === null ? "Copy (NULL → empty)" : "Copy cell",
          icon: icon(Copy),
          onSelect: () => actions.onCopy(asText, "Cell"),
        },
        {
          id: "copy-row-json",
          label: "Copy row as JSON",
          icon: icon(Braces),
          onSelect: () => actions.onCopy(JSON.stringify(rowObject, null, 2), "Row"),
        },
        {
          id: "copy-row-csv",
          label: "Copy row as CSV",
          icon: icon(Rows3),
          onSelect: () =>
            actions.onCopy(
              cell.row.map((v) => (v === null ? "" : String(v))).join(","),
              "Row",
            ),
        },
        {
          id: "copy-row-insert",
          label: "Copy row as INSERT",
          icon: icon(Database),
          disabled: isMongo || !cell.table,
          disabledReason: isMongo ? "SQL only" : "no table in context",
          onSelect: () => {
            const target = cell.table
              ? qualifiedName(cell.engine, cell.table.namespace, cell.table.name)
              : quoteIdent("table");
            const cols = cell.columns.map((c) => quoteIdent(c.name)).join(", ");
            const vals = cell.row.map(sqlLiteral).join(", ");
            actions.onCopy(`INSERT INTO ${target} (${cols}) VALUES (${vals});`, "INSERT");
          },
        },
      ],
    },
    {
      id: "filter",
      label: "Filter",
      items: [
        {
          id: "filter-equals",
          label: `Filter: ${cell.column.name} = this value`,
          icon: icon(Filter),
          onSelect: () =>
            actions.onFilterBy(
              isMongo
                ? JSON.stringify({ [cell.column.name]: cell.value })
                : cell.value === null
                  ? `${columnRef} IS NULL`
                  : `${columnRef} = ${sqlLiteral(cell.value)}`,
            ),
        },
        {
          id: "filter-not",
          label: `Filter: ${cell.column.name} ≠ this value`,
          icon: icon(ListFilter),
          onSelect: () =>
            actions.onFilterBy(
              isMongo
                ? JSON.stringify({ [cell.column.name]: { $ne: cell.value } })
                : cell.value === null
                  ? `${columnRef} IS NOT NULL`
                  : `${columnRef} <> ${sqlLiteral(cell.value)}`,
            ),
        },
      ],
    },
    {
      id: "ai",
      items: [
        {
          id: "ai-about",
          label: "Ask AI about this row…",
          icon: icon(Sparkles),
          onSelect: () =>
            actions.onAskAi(
              `Explain this row and suggest a follow-up query:\n${JSON.stringify(rowObject, null, 2)}`,
            ),
        },
      ],
    },
  ];

  if (actions.onEdit || actions.onSetNull) {
    groups.push({
      id: "edit",
      items: [
        {
          id: "edit-cell",
          label: "Edit cell",
          icon: icon(Pencil),
          disabled: !actions.canEdit,
          disabledReason: actions.editDisabledReason,
          onSelect: () => actions.onEdit?.(),
        },
        {
          id: "set-null",
          label: "Set NULL",
          icon: icon(X),
          danger: true,
          disabled: !actions.canEdit,
          disabledReason: actions.editDisabledReason,
          onSelect: () => actions.onSetNull?.(),
        },
      ],
    });
  }

  return groups;
}

/* ─── Column header ─── */

export interface ColumnMenuActions {
  onSort: (column: string, direction: "asc" | "desc") => void;
  onCopy: (text: string, what: string) => void;
  onHide: (column: string) => void;
  onAskAi: (prompt: string) => void;
}

export function columnMenuGroups(
  column: DbColumn,
  table: { namespace: string; name: string } | null | undefined,
  engine: string,
  actions: ColumnMenuActions,
): ContextMenuGroup[] {
  const target = table ? qualifiedName(engine, table.namespace, table.name) : null;
  return [
    {
      id: "sort",
      items: [
        {
          id: "sort-asc",
          label: "Sort ascending",
          icon: icon(ArrowUpAZ),
          onSelect: () => actions.onSort(column.name, "asc"),
        },
        {
          id: "sort-desc",
          label: "Sort descending",
          icon: icon(ArrowDownAZ),
          onSelect: () => actions.onSort(column.name, "desc"),
        },
      ],
    },
    {
      id: "column",
      items: [
        {
          id: "copy-column",
          label: "Copy column name",
          icon: icon(Copy),
          onSelect: () => actions.onCopy(column.name, "Column name"),
        },
        {
          id: "hide",
          label: "Hide column",
          description: "Display only — the query is unchanged.",
          icon: icon(Ban),
          onSelect: () => actions.onHide(column.name),
        },
      ],
    },
    {
      id: "ai",
      items: [
        {
          id: "ai-distribution",
          label: "Ask AI: summarise this column",
          icon: icon(Wand2),
          disabled: !target,
          disabledReason: "no table in context",
          onSelect: () =>
            actions.onAskAi(
              `Write a query summarising the distribution of ${column.name} in ${target}: counts per distinct value, most common first.`,
            ),
        },
      ],
    },
  ];
}

/** Relations menu for a foreign key — jump to the referenced rows. */
export function relationMenuGroups(
  detail: DbTablePayload,
  engine: string,
  onRun: (sql: string) => void,
): ContextMenuGroup[] {
  return [
    {
      id: "relations",
      label: "Follow relation",
      items: detail.foreignKeys.map((fk) => ({
        id: fk.name,
        label: `${fk.columns.join(", ")} → ${fk.referencedTable}`,
        icon: icon(Link2),
        onSelect: () =>
          onRun(
            `SELECT * FROM ${qualifiedName(engine, fk.referencedNamespace, fk.referencedTable)} LIMIT 200;`,
          ),
      })),
    },
  ];
}
