import { describe, expect, it, vi } from "vitest";
import {
  cellMenuGroups,
  columnMenuGroups,
  connectionMenuGroups,
  objectMenuGroups,
  qualifiedName,
  quoteIdent,
  sqlLiteral,
} from "./menus";
import type { DbConnectionRow } from "./shared";
import type { DbObjectSummary } from "@/lib/db/introspect-types";

import type { ContextMenuGroup, ContextMenuItem } from "@/components/shell/ContextMenu";

const flat = (groups: ContextMenuGroup[]): ContextMenuItem[] => groups.flatMap((g) => g.items);
const byId = (groups: ContextMenuGroup[], id: string) => flat(groups).find((i) => i.id === id);

describe("identifier helpers", () => {
  it("quotes and escapes identifiers", () => {
    expect(quoteIdent("posts")).toBe('"posts"');
    expect(quoteIdent('we"ird')).toBe('"we""ird"');
  });

  /** SQLite has one namespace, so qualifying it is noise. */
  it("qualifies per engine", () => {
    expect(qualifiedName("postgres", "public", "posts")).toBe('"public"."posts"');
    expect(qualifiedName("sqlite", "main", "posts")).toBe('"posts"');
  });

  it("renders SQL literals safely", () => {
    expect(sqlLiteral(null)).toBe("NULL");
    expect(sqlLiteral(7)).toBe("7");
    expect(sqlLiteral(true)).toBe("TRUE");
    expect(sqlLiteral("O'Hara")).toBe("'O''Hara'");
    // Infinity is not a SQL literal; NULL is the honest rendering.
    expect(sqlLiteral(Infinity)).toBe("NULL");
  });
});

const connection = (over: Partial<DbConnectionRow> = {}): DbConnectionRow => ({
  id: "bi:rds:capi:dev",
  label: "CAPI · dev",
  engine: "postgres",
  accessMode: "read",
  dangerous: false,
  source: "plugin:bi",
  ...over,
});

describe("connectionMenuGroups", () => {
  const actions = {
    onOpen: vi.fn(),
    onDisconnect: vi.fn(),
    onRefresh: vi.fn(),
    notify: vi.fn(),
  };

  it("offers Connect when closed and Focus when open", () => {
    expect(byId(connectionMenuGroups(connection(), actions), "open")?.label).toBe("Connect");
    expect(byId(connectionMenuGroups(connection({ open: true }), actions), "open")?.label).toBe(
      "Focus",
    );
  });

  it("disables Disconnect when nothing is open", () => {
    expect(byId(connectionMenuGroups(connection(), actions), "disconnect")?.disabled).toBe(true);
    expect(
      byId(connectionMenuGroups(connection({ open: true }), actions), "disconnect")?.disabled,
    ).toBe(false);
  });

  /** The one-click fix for "this needs a different AWS profile". */
  it("surfaces the provider's remedy when there is one", () => {
    const withRemedy = connection({
      unavailable: "Needs a prd profile.",
      remedy: { id: "aws-profile", label: "Switch to prd-dad", endpoint: "/api/bi/aws-profile" },
    });
    const onRemedy = vi.fn();
    expect(byId(connectionMenuGroups(withRemedy, { ...actions, onRemedy }), "remedy")?.label).toBe(
      "Switch to prd-dad",
    );
  });

  it("omits the remedy entry when there is nothing to fix", () => {
    expect(byId(connectionMenuGroups(connection(), actions), "remedy")).toBeUndefined();
  });

  /** Editing and removing only make sense for connections the user owns. */
  it("offers manage actions only for user connections", () => {
    const manage = { ...actions, onEdit: vi.fn(), onDelete: vi.fn() };
    expect(byId(connectionMenuGroups(connection(), manage), "delete")).toBeUndefined();
    expect(
      byId(connectionMenuGroups(connection({ source: "user" }), manage), "delete"),
    ).toBeDefined();
  });
});

const object: DbObjectSummary = { namespace: "public", name: "posts", kind: "table" };

describe("objectMenuGroups", () => {
  const actions = {
    onRun: vi.fn(),
    onInsertIntoEditor: vi.fn(),
    onStructure: vi.fn(),
    onExport: vi.fn(),
    notify: vi.fn(),
    canWrite: false,
  };

  it("runs a bounded select", () => {
    const onRun = vi.fn();
    byId(objectMenuGroups(object, "postgres", { ...actions, onRun }), "select-200")?.onSelect();
    expect(onRun).toHaveBeenCalledWith('SELECT * FROM "public"."posts" LIMIT 200;');
  });

  it("uses Mongo syntax for a Mongo connection", () => {
    const onRun = vi.fn();
    byId(objectMenuGroups(object, "mongodb", { ...actions, onRun }), "select-200")?.onSelect();
    expect(onRun).toHaveBeenCalledWith("db.posts.find({}).limit(200)");
  });

  /**
   * Destructive statements go to the editor, never straight to the database —
   * one stray click should not be able to drop a table.
   */
  it("writes DROP into the editor rather than running it", () => {
    const onInsertIntoEditor = vi.fn();
    const onRun = vi.fn();
    byId(
      objectMenuGroups(object, "postgres", { ...actions, canWrite: true, onInsertIntoEditor, onRun }),
      "drop",
    )?.onSelect();
    expect(onInsertIntoEditor).toHaveBeenCalledWith('DROP TABLE "public"."posts";');
    expect(onRun).not.toHaveBeenCalled();
  });

  it("disables destructive entries on a read-only connection", () => {
    const groups = objectMenuGroups(object, "postgres", actions);
    expect(byId(groups, "drop")?.disabled).toBe(true);
    expect(byId(groups, "truncate")?.disabled).toBe(true);
  });

  it("disables SQL-only generators for Mongo", () => {
    const groups = objectMenuGroups(object, "mongodb", { ...actions, canWrite: true });
    expect(byId(groups, "gen-insert")?.disabled).toBe(true);
    expect(byId(groups, "truncate")?.disabled).toBe(true);
  });
});

describe("cellMenuGroups", () => {
  const cell = {
    value: "ada",
    column: { name: "name" },
    row: [1, "ada"],
    columns: [{ name: "id" }, { name: "name" }],
    engine: "postgres",
    table: { namespace: "public", name: "authors" },
  };
  const actions = {
    onCopy: vi.fn(),
    onFilterBy: vi.fn(),
    onAskAi: vi.fn(),
    canEdit: true,
  };

  it("copies a row as a runnable INSERT", () => {
    const onCopy = vi.fn();
    byId(cellMenuGroups(cell, { ...actions, onCopy }), "copy-row-insert")?.onSelect();
    expect(onCopy).toHaveBeenCalledWith(
      `INSERT INTO "public"."authors" ("id", "name") VALUES (1, 'ada');`,
      "INSERT",
    );
  });

  it("builds an equality filter", () => {
    const onFilterBy = vi.fn();
    byId(cellMenuGroups(cell, { ...actions, onFilterBy }), "filter-equals")?.onSelect();
    expect(onFilterBy).toHaveBeenCalledWith(`"name" = 'ada'`);
  });

  /** `= NULL` matches nothing — the filter has to become IS NULL. */
  it("uses IS NULL rather than = NULL", () => {
    const onFilterBy = vi.fn();
    byId(
      cellMenuGroups({ ...cell, value: null }, { ...actions, onFilterBy }),
      "filter-equals",
    )?.onSelect();
    expect(onFilterBy).toHaveBeenCalledWith(`"name" IS NULL`);
  });

  it("builds a Mongo filter document for a Mongo connection", () => {
    const onFilterBy = vi.fn();
    byId(
      cellMenuGroups({ ...cell, engine: "mongodb" }, { ...actions, onFilterBy }),
      "filter-equals",
    )?.onSelect();
    expect(onFilterBy).toHaveBeenCalledWith('{"name":"ada"}');
  });

  it("disables editing with the reason when the table has no row identity", () => {
    const groups = cellMenuGroups(cell, {
      ...actions,
      canEdit: false,
      editDisabledReason: "no primary key",
      onEdit: vi.fn(),
    });
    expect(byId(groups, "edit-cell")?.disabled).toBe(true);
  });
});

describe("columnMenuGroups", () => {
  const actions = { onSort: vi.fn(), onCopy: vi.fn(), onHide: vi.fn(), onAskAi: vi.fn() };

  it("sorts in both directions", () => {
    const onSort = vi.fn();
    const groups = columnMenuGroups({ name: "views" }, null, "postgres", { ...actions, onSort });
    byId(groups, "sort-asc")?.onSelect();
    byId(groups, "sort-desc")?.onSelect();
    expect(onSort).toHaveBeenNthCalledWith(1, "views", "asc");
    expect(onSort).toHaveBeenNthCalledWith(2, "views", "desc");
  });

  it("disables the AI summary without a table in context", () => {
    expect(
      byId(columnMenuGroups({ name: "views" }, null, "postgres", actions), "ai-distribution")
        ?.disabled,
    ).toBe(true);
  });
});
