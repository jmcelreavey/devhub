import { describe, expect, it } from "vitest";
import {
  appShortcutFromEvent,
  repoDrillInNameFromPath,
  repoPageOwnsShortcut,
  repoShortcutFromEvent,
  workspaceTabChordFromEvent,
} from "./app-shortcuts";

function event(partial: Partial<Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">>) {
  return {
    key: "k",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...partial,
  };
}

describe("appShortcutFromEvent", () => {
  it("opens the palette on ⌘P / Ctrl+P, not ⌘K", () => {
    expect(appShortcutFromEvent(event({ key: "p", metaKey: true }))).toBe("palette");
    expect(appShortcutFromEvent(event({ key: "p", ctrlKey: true }))).toBe("palette");
    expect(appShortcutFromEvent(event({ key: "k", metaKey: true }))).toBeNull();
  });

  it("opens notes, diagrams, and tasks on ⌘N / ⌘D / ⌘T", () => {
    expect(appShortcutFromEvent(event({ key: "n", metaKey: true }))).toBe("notes");
    expect(appShortcutFromEvent(event({ key: "d", metaKey: true }))).toBe("diagrams");
    expect(appShortcutFromEvent(event({ key: "t", metaKey: true }))).toBe("tasks");
  });

  it("keeps the previous shift aliases", () => {
    expect(appShortcutFromEvent(event({ key: "o", metaKey: true, shiftKey: true }))).toBe("notes");
    expect(appShortcutFromEvent(event({ key: "d", metaKey: true, shiftKey: true }))).toBe("diagrams");
    expect(appShortcutFromEvent(event({ key: "t", metaKey: true, shiftKey: true }))).toBe("tasks");
    expect(appShortcutFromEvent(event({ key: "c", metaKey: true, shiftKey: true }))).toBe("capture");
  });

  it("does not treat ⌘⇧P as palette (print-adjacent) or steal Alt chords", () => {
    expect(appShortcutFromEvent(event({ key: "p", metaKey: true, shiftKey: true }))).toBeNull();
    expect(appShortcutFromEvent(event({ key: "t", metaKey: true, altKey: true }))).toBeNull();
  });
});

describe("repoShortcutFromEvent", () => {
  it("maps ⌘Enter / Ctrl+Enter to upstart and ⌘⇧T to terminal", () => {
    expect(repoShortcutFromEvent(event({ key: "Enter", metaKey: true }))).toBe("upstart");
    expect(repoShortcutFromEvent(event({ key: "Enter", ctrlKey: true }))).toBe("upstart");
    expect(repoShortcutFromEvent(event({ key: "t", metaKey: true, shiftKey: true }))).toBe("terminal");
    expect(repoShortcutFromEvent(event({ key: "t", ctrlKey: true, shiftKey: true }))).toBe("terminal");
  });

  it("does not steal ⌘T (tasks), ⌘⇧Enter, or Alt chords", () => {
    expect(repoShortcutFromEvent(event({ key: "t", metaKey: true }))).toBeNull();
    expect(repoShortcutFromEvent(event({ key: "Enter", metaKey: true, shiftKey: true }))).toBeNull();
    expect(repoShortcutFromEvent(event({ key: "Enter", metaKey: true, altKey: true }))).toBeNull();
  });
});

describe("repoDrillInNameFromPath", () => {
  it("returns the repo name for a drill-in, not the list", () => {
    expect(repoDrillInNameFromPath("/repos/acme-api")).toBe("acme-api");
    expect(repoDrillInNameFromPath("/repos/acme-api?tab=git")).toBe("acme-api");
    expect(repoDrillInNameFromPath("/repos")).toBeNull();
    expect(repoDrillInNameFromPath("/notes")).toBeNull();
  });
});

describe("repoPageOwnsShortcut", () => {
  it("claims ⌘Enter / ⌘⇧T only on a repo drill-in", () => {
    const enter = event({ key: "Enter", metaKey: true });
    const shiftT = event({ key: "t", metaKey: true, shiftKey: true });
    expect(repoPageOwnsShortcut(enter, "/repos/acme-api")).toBe(true);
    expect(repoPageOwnsShortcut(shiftT, "/repos/acme-api")).toBe(true);
    expect(repoPageOwnsShortcut(enter, "/repos")).toBe(false);
    expect(repoPageOwnsShortcut(shiftT, "/work")).toBe(false);
    expect(repoPageOwnsShortcut(event({ key: "t", metaKey: true }), "/repos/acme-api")).toBe(false);
  });
});

describe("workspaceTabChordFromEvent", () => {
  it("jumps to tab N on ⌘1–⌘9", () => {
    expect(workspaceTabChordFromEvent(event({ key: "1", metaKey: true }))).toEqual({ type: "jump", index: 1 });
    expect(workspaceTabChordFromEvent(event({ key: "9", ctrlKey: true }))).toEqual({ type: "jump", index: 9 });
  });

  it("does not steal ⌘P / ⌘T or Shift+digit", () => {
    expect(workspaceTabChordFromEvent(event({ key: "p", metaKey: true }))).toBeNull();
    expect(workspaceTabChordFromEvent(event({ key: "t", metaKey: true }))).toBeNull();
    expect(workspaceTabChordFromEvent(event({ key: "1", metaKey: true, shiftKey: true }))).toBeNull();
  });

  it("cycles with Ctrl+Tab / Ctrl+Shift+Tab, not Cmd+Tab", () => {
    expect(workspaceTabChordFromEvent(event({ key: "Tab", ctrlKey: true }))).toEqual({ type: "cycle", dir: 1 });
    expect(workspaceTabChordFromEvent(event({ key: "Tab", ctrlKey: true, shiftKey: true }))).toEqual({
      type: "cycle",
      dir: -1,
    });
    expect(workspaceTabChordFromEvent(event({ key: "Tab", metaKey: true }))).toBeNull();
  });
});
