import { describe, expect, it } from "vitest";
import {
  activateTab,
  applyPaletteNavigation,
  closeTab,
  createTab,
  cycleTab,
  describeHref,
  jumpToIndex,
  navigateCurrent,
  normalizeHref,
  parseStored,
  serializeState,
} from "./workspace-tabs";

function state(hrefs: string[], active = 0) {
  const tabs = hrefs.map((href, i) => createTab(href, `id-${i}`));
  return { tabs, activeId: tabs[active]!.id };
}

describe("describeHref", () => {
  it("uses the repo name for /repos/:name", () => {
    expect(describeHref("/repos/acme-api")).toEqual({ title: "acme-api", kind: "repo" });
    expect(describeHref("/repos/demo-app")).toEqual({ title: "demo-app", kind: "repo" });
  });

  it("uses the page name for nav destinations", () => {
    expect(describeHref("/work")).toEqual({ title: "Work", kind: "nav" });
    expect(describeHref("/")).toEqual({ title: "Today", kind: "nav" });
    expect(describeHref("/repos")).toEqual({ title: "Repos", kind: "nav" });
  });

  it("updates a nested notes path to the file name", () => {
    expect(describeHref("/notes/daily/2026-08-26")).toEqual({
      title: "2026-08-26",
      kind: "note",
    });
  });
});

describe("normalizeHref", () => {
  it("strips trailing slashes but keeps query strings", () => {
    expect(normalizeHref("/work/")).toBe("/work");
    expect(normalizeHref("/repos?view=owned")).toBe("/repos?view=owned");
    expect(normalizeHref("/")).toBe("/");
  });
});

describe("navigateCurrent / openNew", () => {
  it("replaces the active tab on a normal palette activation", () => {
    const next = navigateCurrent(state(["/", "/work"]), "/repos/acme-api");
    expect(next.tabs.map((t) => t.href)).toEqual(["/repos/acme-api", "/work"]);
    expect(next.tabs[0]?.title).toBe("acme-api");
    expect(next.activeId).toBe("id-0");
  });

  it("opens a new tab on shift-activation", () => {
    const next = applyPaletteNavigation(state(["/"]), "/repos/acme-api", true);
    expect(next.tabs.map((t) => t.href)).toEqual(["/", "/repos/acme-api"]);
    expect(next.activeId).toBe(next.tabs[1]?.id);
  });

  it("Enter on an already-open href switches to that tab instead of duplicating", () => {
    const next = applyPaletteNavigation(state(["/", "/repos/acme-api"], 0), "/repos/acme-api", false);
    expect(next.tabs).toHaveLength(2);
    expect(next.activeId).toBe("id-1");
  });

  it("Shift+Enter on an already-open href also switches, not duplicates", () => {
    const next = applyPaletteNavigation(state(["/", "/repos/demo-app"], 0), "/repos/demo-app", true);
    expect(next.tabs).toHaveLength(2);
    expect(next.activeId).toBe("id-1");
  });
});

describe("closeTab", () => {
  it("refuses to close the last tab", () => {
    const s = state(["/"]);
    expect(closeTab(s, s.activeId)).toEqual(s);
  });

  it("activates a neighbour when the active tab is closed", () => {
    const next = closeTab(state(["/", "/work", "/repos/acme-api"], 1), "id-1");
    expect(next.tabs.map((t) => t.href)).toEqual(["/", "/repos/acme-api"]);
    expect(next.activeId).toBe("id-2");
  });
});

describe("activate / cycle / jump", () => {
  it("activateTab ignores unknown ids", () => {
    const s = state(["/", "/work"]);
    expect(activateTab(s, "nope")).toEqual(s);
  });

  it("cycles wrapping around", () => {
    const s = state(["/", "/work", "/repos/acme-api"], 2);
    expect(cycleTab(s, 1).activeId).toBe("id-0");
    expect(cycleTab(s, -1).activeId).toBe("id-1");
  });

  it("jumps to 1-based index for ⌘1–⌘9", () => {
    const s = state(["/", "/work", "/repos/acme-api"]);
    expect(jumpToIndex(s, 2).activeId).toBe("id-1");
    expect(jumpToIndex(s, 9)).toEqual(s);
  });
});

describe("persist", () => {
  it("round-trips tabs through JSON", () => {
    const s = state(["/", "/repos/acme-api"], 1);
    const restored = parseStored(serializeState(s), "/");
    expect(restored.tabs.map((t) => t.href)).toEqual(["/", "/repos/acme-api"]);
    expect(restored.activeId).toBe("id-1");
  });

  it("falls back on garbage", () => {
    const restored = parseStored("not-json", "/work");
    expect(restored.tabs).toHaveLength(1);
    expect(restored.tabs[0]?.href).toBe("/work");
  });
});
