import { describe, expect, it } from "vitest";
import {
  alphanumericCompact,
  compactTokenScore,
  filterVisiblePaletteCommands,
  paletteCommandScore,
  uniqueById,
} from "./command-palette-score";

describe("alphanumericCompact", () => {
  it("strips punctuation and case", () => {
    expect(alphanumericCompact("PTF-34")).toBe("ptf34");
    expect(alphanumericCompact("Go to Notes")).toBe("gotonotes");
  });
});

describe("compactTokenScore", () => {
  it("matches ticket key without hyphen", () => {
    expect(compactTokenScore("PTF34", "PTF-34")).toBe(8000);
    expect(compactTokenScore("ptf34", "PTF-34")).toBe(8000);
  });

  it("does not match reversed digit-first query", () => {
    expect(compactTokenScore("34PTF", "PTF-34")).toBe(0);
  });

  it("matches nav-style labels when typing run-together", () => {
    expect(compactTokenScore("gotonotes", "Go to Notes")).toBeGreaterThan(0);
  });
});

describe("paletteCommandScore", () => {
  it("uses best field across key and summary", () => {
    const s = paletteCommandScore("PTF34", [
      "Fix the widget alignment on mobile",
      "PTF-34",
      "In Progress",
    ]);
    expect(s).toBe(8000);
  });

  it("matches note path segments in one blob", () => {
    const s = paletteCommandScore("learningsfoo", ["Foo", "learnings/foo"]);
    expect(s).toBeGreaterThan(1000);
  });
});


function shortcutCatalog() {
  return [
    { id: "action:shortcuts", kind: "action", label: "Show keyboard shortcuts", hint: "?" },
    { id: "action:shortcuts", kind: "action", label: "Keyboard shortcuts", hint: "?" },
    { id: "action:sidebar", kind: "action", label: "Toggle sidebar", hint: "⌘\\" },
  ];
}

describe("uniqueById", () => {
  it("keeps the first shortcuts row when the catalog registered it twice", () => {
    const rows = uniqueById(shortcutCatalog());
    expect(rows.filter((c) => c.id === "action:shortcuts")).toHaveLength(1);
    expect(rows[0]?.label).toBe("Show keyboard shortcuts");
  });
});

describe("filterVisiblePaletteCommands", () => {
  it("keeps the default list focused on recent destinations, active repos and common actions", () => {
    const recent = Array.from({ length: 8 }, (_, i) => ({ id: `recent:${i}`, kind: "nav", label: `Recent ${i}` }));
    const repos = Array.from({ length: 6 }, (_, i) => ({
      id: `repo:${i}`, kind: "repo", label: `Repo ${i}`, detail: "main · 1 changed",
    }));
    const generatedActions = Array.from({ length: 60 }, (_, i) => ({
      id: `action:terminal:${i}`, kind: "action", label: `Open terminal for repo ${i}`,
    }));
    const commonActions = ["capture", "today-note", "ask-agent", "shortcuts"].map((name) => ({
      id: `action:${name}`, kind: "action", label: name,
    }));
    const catalog = [
      ...generatedActions,
      { id: "repo:clean", kind: "repo", label: "Clean repo", detail: "main" },
      ...repos,
      ...commonActions,
      { id: "note:one", kind: "note", label: "A note" },
      { id: "task:one", kind: "task", label: "A task" },
    ];

    expect(filterVisiblePaletteCommands(catalog, "", { recent }).map((c) => c.id)).toEqual([
      ...recent.slice(0, 5).map((c) => c.id),
      ...repos.slice(0, 3).map((c) => c.id),
      ...commonActions.map((c) => c.id),
    ]);
  });

  it("filters the scope before scoring and capping matches", () => {
    const catalog = [
      ...Array.from({ length: 45 }, (_, i) => ({ id: `repo:${i}`, kind: "repo", label: "Widget" })),
      { id: "note:widget", kind: "note", label: "Widget handbook" },
      { id: "diagram:widget", kind: "diagram", label: "Widget architecture" },
    ];

    expect(filterVisiblePaletteCommands(catalog, "widget", { scope: "note" }).map((c) => c.id)).toEqual([
      "note:widget", "diagram:widget",
    ]);
  });

  it("keeps full-text note hits in the Notes scope while excluding docs and duplicate note hits", () => {
    const catalog = [{ id: "note:widget", kind: "note", label: "Widget", detail: "notes/widget" }];
    const contentResults = [
      { id: "content:notes:notes/widget", kind: "content", label: "notes/widget" },
      { id: "content:notes:notes/other", kind: "content", label: "notes/other" },
      { id: "content:docs:widget", kind: "content", label: "Widget docs" },
      { id: "content:terminal:widget", kind: "content", label: "Widget command" },
    ];
    expect(filterVisiblePaletteCommands(catalog, "widget", { scope: "note", contentResults }).map((c) => c.id))
      .toEqual(["note:widget", "content:notes:notes/other"]);
  });

  it("includes tickets in the task scope and excludes content from other scopes", () => {
    const catalog = [
      { id: "task:widget", kind: "task", label: "Widget" },
      { id: "ticket:widget", kind: "ticket", label: "Widget ticket" },
      { id: "repo:widget", kind: "repo", label: "Widget repo" },
    ];
    const contentResults = [{ id: "content:widget", kind: "content", label: "notes/widget" }];

    expect(filterVisiblePaletteCommands(catalog, "widget", { scope: "task", contentResults }).map((c) => c.id))
      .toEqual(["task:widget", "ticket:widget"]);
    expect(filterVisiblePaletteCommands(catalog, "widget", { scope: "content", contentResults }))
      .toEqual(contentResults);
  });

  it("shows at most twenty matching commands for an empty scope, with content waiting for a query", () => {
    const catalog = [
      { id: "repo:one", kind: "repo", label: "Repo" },
      ...Array.from({ length: 25 }, (_, i) => ({ id: `note:${i}`, kind: "note", label: `Note ${i}` })),
    ];
    expect(filterVisiblePaletteCommands(catalog, "", { scope: "note" })).toEqual(catalog.slice(1, 21));
    expect(filterVisiblePaletteCommands(catalog, "", {
      scope: "content",
      contentResults: [{ id: "content:one", kind: "content", label: "notes/one" }],
    })).toEqual([]);
  });

  it("suppresses body hits for notes and diagrams already matched by name", () => {
    const catalog = [
      { id: "note:widget", kind: "note", label: "Widget", detail: "notes/widget" },
      { id: "diagram:widget", kind: "diagram", label: "Widget diagram", detail: "diagrams/widget" },
    ];
    const contentResults = [
      { id: "content:note", kind: "content", label: "notes/widget" },
      { id: "content:diagram", kind: "content", label: "diagrams/widget" },
      { id: "content:other", kind: "content", label: "notes/other" },
      { id: "content:other", kind: "content", label: "notes/other" },
    ];

    expect(filterVisiblePaletteCommands(catalog, "widget", { contentResults }).map((c) => c.id))
      .toEqual(["note:widget", "diagram:widget", "content:other"]);
  });

  it("shows shortcuts once after two clear-and-search cycles", () => {
    const catalog = shortcutCatalog();
    const cycle = (query: string) =>
      filterVisiblePaletteCommands(catalog, query).filter((c) => c.id === "action:shortcuts");

    expect(cycle("")).toHaveLength(1);
    expect(cycle("shortcut")).toHaveLength(1);
    expect(cycle("")).toHaveLength(1);
    const secondSearch = cycle("shortcut");
    expect(secondSearch).toHaveLength(1);
    expect(secondSearch.map((c) => c.label)).toEqual(["Show keyboard shortcuts"]);
  });
});
