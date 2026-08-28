import { describe, expect, it } from "vitest";
import {
  MAX_WORKSPACE_TABS,
  activateTab,
  applyPaletteNavigation,
  canOpenTab,
  closeTab,
  createTab,
  cycleTab,
  describeHref,
  jumpToIndex,
  navigateCurrent,
  normalizeHref,
  openBlank,
  openNew,
  parseStored,
  publishActiveLabel,
  serializeState,
  syncActiveHref,
  updateTabTitle,
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

  it("Shift+click always inserts a new tab after the active one when a neighbour exists", () => {
    const next = openNew(state(["/", "/work"], 0), "/notes/x");
    expect(next.tabs.map((t) => t.href)).toEqual(["/", "/notes/x", "/work"]);
    expect(next.tabs[2]?.id).toBe("id-1");
    expect(next.tabs[2]?.href).toBe("/work");
    expect(next.activeId).toBe(next.tabs[1]?.id);
  });

  it("Shift+click duplicates an already-open href instead of focusing or replacing a neighbour", () => {
    const next = openNew(state(["/", "/work"], 0), "/work");
    expect(next.tabs.map((t) => t.href)).toEqual(["/", "/work", "/work"]);
    expect(next.tabs[2]?.id).toBe("id-1");
    expect(next.activeId).toBe(next.tabs[1]?.id);
    expect(next.activeId).not.toBe("id-1");
  });
});

describe("syncActiveHref", () => {
  it("updates only the active tab and does not steal a neighbour with the same href", () => {
    const s = state(["/notes/a", "/notes/b"], 0);
    const next = syncActiveHref(s, "/notes/b");
    expect(next.activeId).toBe("id-0");
    expect(next.tabs.map((t) => t.href)).toEqual(["/notes/b", "/notes/b"]);
    expect(next.tabs[1]?.id).toBe("id-1");
  });

  it("is a no-op when the active tab already has this href (href-sync after openNew)", () => {
    const s = openNew(state(["/", "/work"], 0), "/notes/x");
    const next = syncActiveHref(s, "/notes/x");
    expect(next.tabs.map((t) => t.href)).toEqual(["/", "/notes/x", "/work"]);
    expect(next).toBe(s);
  });
});

describe("per-tab history", () => {
  it("seeds a new tab with its own trail, not the previous tab's", () => {
    const s = navigateCurrent(state(["/"]), "/notes/a");
    const next = openNew(s, "/notes/b");
    expect(next.tabs[0]?.history?.map((e) => e.href)).toEqual(["/", "/notes/a"]);
    expect(next.tabs[1]?.history?.map((e) => e.href)).toEqual(["/notes/b"]);
  });

  it("does not append history when switching tabs", () => {
    const s = state(["/", "/work"], 0);
    const before = s.tabs.map((t) => t.history);
    const next = activateTab(s, "id-1");
    expect(next.tabs.map((t) => t.history)).toEqual(before);
  });

  it("records in-tab navigation on the active tab only", () => {
    const next = navigateCurrent(state(["/", "/work"], 0), "/notes/hello");
    expect(next.tabs[0]?.history?.map((e) => e.href)).toEqual(["/", "/notes/hello"]);
    expect(next.tabs[1]?.history?.map((e) => e.href)).toEqual(["/work"]);
  });
});

describe("note title override", () => {
  it("publishes a content title onto the active tab and its crumb", () => {
    const href = "/notes/pr-reviews/app-poc-ptf-4785-bookmark-backend";
    const s = state([href]);
    expect(s.tabs[0]?.title).toBe("app-poc-ptf-4785-bookmark-backend");
    const next = publishActiveLabel(s, href, "Bookmark backend contract and data layer");
    expect(next.tabs[0]?.title).toBe("Bookmark backend contract and data layer");
    expect(next.tabs[0]?.history?.at(-1)?.label).toBe(
      "Bookmark backend contract and data layer",
    );
  });

  it("updateTabTitle leaves other tabs alone", () => {
    const s = state(["/", "/work"], 0);
    const next = updateTabTitle(s, "id-0", "Home");
    expect(next.tabs[0]?.title).toBe("Home");
    expect(next.tabs[1]?.title).toBe("Work");
  });
});

describe("openBlank", () => {
  it("opens a fresh Today tab and focuses it", () => {
    const next = openBlank(state(["/work"]));
    expect(next.tabs.map((t) => t.href)).toEqual(["/work", "/"]);
    expect(next.tabs[1]?.title).toBe("Today");
    expect(next.activeId).toBe(next.tabs[1]?.id);
  });

  /**
   * The whole point of the "+" button: focusing an existing Today tab looks
   * like the button did nothing.
   */
  it("duplicates rather than focusing when that href is already open", () => {
    const next = openBlank(state(["/"]));
    expect(next.tabs).toHaveLength(2);
    expect(next.tabs.map((t) => t.href)).toEqual(["/", "/"]);
    expect(next.activeId).toBe(next.tabs[1]?.id);
  });

  it("takes an explicit href", () => {
    expect(openBlank(state(["/"]), "/repos/acme-api").tabs[1]?.href).toBe("/repos/acme-api");
  });

  /** Storage truncates to the cap on read, so opening past it lost tabs silently. */
  it("stops at the cap instead of opening a tab that will not survive a reload", () => {
    const full = state(Array.from({ length: MAX_WORKSPACE_TABS }, (_, i) => `/repos/r${i}`));
    expect(canOpenTab(full)).toBe(false);
    expect(openBlank(full)).toBe(full);
    expect(openNew(full, "/brand-new")).toBe(full);
  });

  it("allows opening one below the cap", () => {
    const nearly = state(Array.from({ length: MAX_WORKSPACE_TABS - 1 }, (_, i) => `/repos/r${i}`));
    expect(canOpenTab(nearly)).toBe(true);
    expect(openBlank(nearly).tabs).toHaveLength(MAX_WORKSPACE_TABS);
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
    expect(restored.tabs[1]?.history?.map((e) => e.href)).toEqual(["/repos/acme-api"]);
  });

  it("hydrates tabs saved without history", () => {
    const raw = JSON.stringify({
      v: 1,
      activeId: "id-0",
      tabs: [{ id: "id-0", href: "/work", title: "Work", kind: "nav" }],
    });
    const restored = parseStored(raw, "/");
    expect(restored.tabs[0]?.history).toEqual([{ href: "/work", label: "Work", ts: 0 }]);
  });

  it("falls back on garbage", () => {
    const restored = parseStored("not-json", "/work");
    expect(restored.tabs).toHaveLength(1);
    expect(restored.tabs[0]?.href).toBe("/work");
  });
});
