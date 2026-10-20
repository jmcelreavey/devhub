/** @vitest-environment jsdom */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Copy, FileText, Trash2 } from "lucide-react";
import { ContextMenu, menuGroupsWithDangerLast, type ContextMenuGroup } from "./ContextMenu";
import { LaunchMenu } from "./LaunchMenu";
import { buildEntityRefMenuGroups } from "@/lib/entity-ref-menu";
import { buildVaultFileMenuGroups, buildVaultFolderMenuGroups } from "../vault/vaultRowMenus";

afterEach(cleanup);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(path) && !/\.(test|spec)\./.test(path) ? [path] : [];
  });
}

describe("dashboard action menu conventions", () => {
  it("declares an icon for every action item, including disabled and conditional items", () => {
    const missing: string[] = [];
    for (const directory of ["app", "components", "lib"]) {
      for (const path of sourceFiles(join(process.cwd(), directory))) {
        const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
        function visit(node: ts.Node) {
          if (ts.isObjectLiteralExpression(node)) {
            const names = node.properties.map((property) => property.name?.getText(source));
            if (["id", "label", "onSelect"].every((name) => names.includes(name)) && !names.includes("icon")) {
              const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
              missing.push(`${relative(process.cwd(), path)}:${line}`);
            }
          }
          ts.forEachChild(node, visit);
        }
        visit(source);
      }
    }
    expect(missing, "Action menu items need a meaningful icon").toEqual([]);
  });

  it.each(["notes", "diagrams", "docs"] as const)("renders an icon on every %s file action", (kind) => {
    const action = vi.fn();
    const groups = buildVaultFileMenuGroups({
      kind, itemLabel: "file", onOpen: action, onOpenInCursor: action,
      onCopyLocation: action, onCopyMarkdown: action, onShare: action,
      onCreateTasksFrom: action, onOneTime: action, onRename: action,
      onDuplicate: action, onMove: action, onDelete: action,
    });
    render(<ContextMenu open position={{ x: 10, y: 10 }} groups={groups} onClose={action} />);
    const items = screen.getAllByRole("menuitem", { hidden: true });
    expect(items).toHaveLength(11);
    for (const item of items) expect(item.querySelector(".context-menu-icon svg")).not.toBeNull();
    expect(items.at(-1)?.getAttribute("data-danger")).toBe("true");
    expect(items.at(-1)?.closest(".context-menu-group")?.querySelector('[role="separator"]')).not.toBeNull();
  });

  it("groups Jira chip actions before copying and renders every icon", () => {
    const action = vi.fn();
    const groups = buildEntityRefMenuGroups({ kind: "jira", id: "ABC-123", label: "ABC-123" }, {
      onOpen: action, onCopy: action, onUpdateJiraState: action, onOpenNote: action,
    });
    expect(groups.map((group) => group.label)).toEqual(["Ticket", "Copy"]);
    expect(groups.flatMap((group) => group.items.map((item) => item.id))).toEqual([
      "open-jira", "update-state", "note", "copy-key",
    ]);
    render(<ContextMenu open position={{ x: 10, y: 10 }} groups={groups} onClose={action} />);
    for (const item of screen.getAllByRole("menuitem", { hidden: true })) {
      expect(item.querySelector(".context-menu-icon svg")).not.toBeNull();
    }
  });

  it("keeps folder creation before organising, copying and deletion", () => {
    const action = vi.fn();
    const groups = buildVaultFolderMenuGroups({
      itemLabel: "note", onNewItem: action, onNewFolder: action, onCopyPath: action,
      onRename: action, onMove: action, onDelete: action,
    });
    expect(groups.flatMap((group) => group.items.map((item) => item.id))).toEqual([
      "new", "new-folder", "rename", "move", "copy", "delete-folder",
    ]);
    render(<ContextMenu open position={{ x: 10, y: 10 }} groups={groups} onClose={action} />);
    for (const item of screen.getAllByRole("menuitem", { hidden: true })) {
      expect(item.querySelector(".context-menu-icon svg")).not.toBeNull();
    }
  });

  it("separates destructive actions after appended links without mutating callers", () => {
    const action = vi.fn();
    const groups: ContextMenuGroup[] = [
      { id: "mixed", label: "Work", items: [
        { id: "delete", label: "Delete", danger: true, icon: <Trash2 size={12} />, onSelect: action },
        { id: "open", label: "Open", icon: <FileText size={12} />, onSelect: action },
      ] },
      { id: "links", label: "Links", items: [{ id: "copy", label: "Copy", icon: <Copy size={12} />, onSelect: action }] },
    ];
    expect(menuGroupsWithDangerLast(groups).flatMap((group) => group.items.map((item) => item.id))).toEqual(["open", "copy", "delete"]);
    expect(groups[0].items[0].id).toBe("delete");
  });

  it("navigates launch-menu sections in rendered order, supports typeahead and restores focus", () => {
    const action = vi.fn();
    render(<LaunchMenu label="Actions" sections={["Open", "Copy"]} items={[
      { id: "delete", label: "Delete", danger: true, icon: <Trash2 size={12} />, onSelect: action },
      { id: "copy", label: "Copy location", section: "Copy", icon: <Copy size={12} />, onSelect: action },
      { id: "open", label: "Open note", section: "Open", icon: <FileText size={12} />, onSelect: action },
    ]} />);
    const trigger = screen.getByRole("button", { name: "Actions" });
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu", { hidden: true });
    const items = screen.getAllByRole("menuitem", { hidden: true });
    expect(items.map((item) => item.textContent)).toEqual(["Open note", "Copy location", "Delete"]);
    for (const item of items) expect(item.querySelector(".launch-menu-icon svg")).not.toBeNull();
    fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(menu, { key: "c" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});
