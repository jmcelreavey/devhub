/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QuickActionsMenu, type QuickMenuAction } from "./QuickActionsMenu";

const ACTIONS: QuickMenuAction[] = [
  { id: "notes", label: "Notes", icon: null, event: "devhub:notes-toggle", shortcut: "⌘⇧O" },
  { id: "tasks", label: "Tasks", icon: null, event: "devhub:tasks-toggle" },
  { id: "setup", label: "Setup & integrations", icon: null, href: "/setup" },
];

function open() {
  fireEvent.click(screen.getByRole("button", { name: "More tools" }));
}

describe("QuickActionsMenu", () => {
  it("labels its trigger and keeps the menu closed until asked", () => {
    render(<QuickActionsMenu actions={ACTIONS} label="More tools" />);
    const trigger = screen.getByRole("button", { name: "More tools" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens with the first item focused and shows shortcut hints", () => {
    render(<QuickActionsMenu actions={ACTIONS} label="More tools" />);
    open();
    const items = screen.getAllByRole("menuitem");
    expect(items.map((el) => el.textContent)).toEqual([
      "Notes⌘⇧O",
      "Tasks",
      "Setup & integrations",
    ]);
    expect(document.activeElement).toBe(items[0]);
  });

  it("opens by pointer with no item focused, so no item can show a ring", () => {
    render(<QuickActionsMenu actions={ACTIONS} label="More tools" />);
    // A real mouse click reports detail >= 1; Enter/Space and script clicks report 0.
    fireEvent.click(screen.getByRole("button", { name: "More tools" }), { detail: 1 });
    const menu = screen.getByRole("menu");
    expect(document.activeElement).toBe(menu);
    expect(screen.getAllByRole("menuitem")).not.toContain(document.activeElement);
  });

  it("still reaches the items with the arrow keys after a pointer open", () => {
    render(<QuickActionsMenu actions={ACTIONS} label="More tools" />);
    fireEvent.click(screen.getByRole("button", { name: "More tools" }), { detail: 1 });
    const menu = screen.getByRole("menu");
    const items = screen.getAllByRole("menuitem");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);
    // Back to the container-focused state, then ArrowUp lands on the last item.
    (menu as HTMLElement).focus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[2]);
  });

  it("closes on Escape after a pointer open and hands focus back", () => {
    render(<QuickActionsMenu actions={ACTIONS} label="More tools" />);
    fireEvent.click(screen.getByRole("button", { name: "More tools" }), { detail: 1 });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "More tools" }));
  });

  it("opens from the keyboard (Enter/Space click) with the first item focused", () => {
    render(<QuickActionsMenu actions={ACTIONS} label="More tools" />);
    fireEvent.click(screen.getByRole("button", { name: "More tools" }), { detail: 0 });
    expect(document.activeElement).toBe(screen.getAllByRole("menuitem")[0]);
  });

  it("fires the panel's window event and closes", () => {
    const onToggle = vi.fn();
    window.addEventListener("devhub:tasks-toggle", onToggle);
    render(<QuickActionsMenu actions={ACTIONS} label="More tools" />);
    open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Tasks" }));
    window.removeEventListener("devhub:tasks-toggle", onToggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("dismisses on Tab and restores the trigger before native tab navigation", () => {
    render(<QuickActionsMenu actions={ACTIONS} label="More tools" />);
    open();
    const items = screen.getAllByRole("menuitem");
    expect(items.every((item) => item.tabIndex === -1)).toBe(true);
    fireEvent.keyDown(items[0], { key: "Tab" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "More tools" }));
  });

  it("opens from ArrowUp at the last action", () => {
    render(<QuickActionsMenu actions={ACTIONS} label="More tools" />);
    fireEvent.keyDown(screen.getByRole("button", { name: "More tools" }), { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getAllByRole("menuitem").at(-1));
  });

  it("renders navigation items as links", () => {
    render(<QuickActionsMenu actions={ACTIONS} label="More tools" />);
    open();
    const setup = screen.getByRole("menuitem", { name: "Setup & integrations" });
    expect(setup.tagName).toBe("A");
    expect(setup.getAttribute("href")).toBe("/setup");
  });

  it("moves with the arrow keys and wraps", () => {
    render(<QuickActionsMenu actions={ACTIONS} label="More tools" />);
    open();
    const items = screen.getAllByRole("menuitem");
    fireEvent.keyDown(items[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(items[2], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);
  });

  it("closes on Escape and hands focus back to the trigger", () => {
    render(<QuickActionsMenu actions={ACTIONS} label="More tools" />);
    open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "More tools" }));
  });
});
