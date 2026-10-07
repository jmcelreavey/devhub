import { describe,expect,it } from "vitest";
import {
ALL_NAV_DESTINATIONS,
LEGACY_NAV_ITEMS,
NAV_GROUPS,
NAV_ITEMS,
SECTION_TABS,
activeNavHref,
filterNavBySetup,
groupSidebarNav,
} from "./nav";
import { PLUGIN_NAV_ITEMS } from "./plugin-nav.generated";

const hrefs = (items: ReturnType<typeof filterNavBySetup>) => items.map((i) => i.href);

describe("NAV_ITEMS (sidebar IA)", () => {
  it("has one shared Agents destination among 14 core destinations", () => {
    expect(NAV_ITEMS).toHaveLength(14);
  });

  it("gives the database client a library slot beside Repos", () => {
    const db = NAV_ITEMS.find((item) => item.href === "/db");
    expect(db?.group).toBe("library");
    // Desktop-only for the same reason Repos is: it reaches local files and
    // local CLIs. Ungated on purpose — a SQLite file needs no integration, so
    // gating it would hide the one part that works on a fresh machine.
    expect(db?.desktopOnly).toBe(true);
    expect(db?.gate).toBeUndefined();
  });

  it("folds owned repos into Repos instead of a competing sidebar slot", () => {
    expect(hrefs(NAV_ITEMS)).not.toContain("/own");
    expect(hrefs(NAV_ITEMS)).toContain("/repos");
    expect(LEGACY_NAV_ITEMS.find((item) => item.href === "/own")?.label).toBe("Owned repos");
    expect(hrefs(ALL_NAV_DESTINATIONS)).toContain("/own");
  });

  it("gives Search the unified-discovery slot in the library group", () => {
    const search = NAV_ITEMS.find((item) => item.href === "/search");
    expect(search).toBeDefined();
    expect(search?.group).toBe("library");
    // Ungated on purpose: search works with zero integrations configured, so
    // hiding it behind a setup gate would hide the one page that is useful on
    // a fresh machine.
    expect(search?.gate).toBeUndefined();
  });

  it("keeps Recall routable but out of the sidebar (unified into /search)", () => {
    expect(hrefs(NAV_ITEMS)).not.toContain("/recall");
    expect(hrefs(ALL_NAV_DESTINATIONS)).toContain("/recall");
  });

  it("keeps merged pages out of the sidebar but in the destination list", () => {
    const sidebar = hrefs(NAV_ITEMS);
    for (const legacy of ["/recall", "/docs", "/learnings", "/diagrams", "/setup"]) {
      expect(sidebar).not.toContain(legacy);
      expect(hrefs(ALL_NAV_DESTINATIONS)).toContain(legacy);
    }
  });

  it("does not breed extinct /tasks and /tickets destinations", () => {
    expect(hrefs(LEGACY_NAV_ITEMS)).not.toContain("/tasks");
    expect(hrefs(LEGACY_NAV_ITEMS)).not.toContain("/tickets");
    expect(hrefs(ALL_NAV_DESTINATIONS)).not.toContain("/tasks");
    expect(hrefs(ALL_NAV_DESTINATIONS)).not.toContain("/tickets");
  });

  it("exposes Work, Library and System as the merged destinations", () => {
    const sidebar = hrefs(NAV_ITEMS);
    expect(sidebar).toContain("/work");
    expect(sidebar).toContain("/notes"); // Library
    expect(sidebar).toContain("/status"); // System
  });
  it("gives Datadog a first-class BI sidebar slot", () => {
    const datadog = NAV_ITEMS.find((item) => item.href === "/datadog");
    expect(datadog).toBeDefined();
    expect(datadog?.group).toBe("bi");
    expect(datadog?.gate).toBe("datadog");
    expect(hrefs(LEGACY_NAV_ITEMS)).not.toContain("/datadog");
  });
  it("exposes a BI nav group between Library and System", () => {
    expect(NAV_GROUPS.map((g) => g.id)).toEqual(["workspace", "library", "bi", "system"]);
  });
  it("merges plugin Ops into the BI sidebar group ahead of Datadog", () => {
    if (!PLUGIN_NAV_ITEMS.some((i) => i.href === "/ops")) return;
    const grouped = groupSidebarNav(NAV_ITEMS, PLUGIN_NAV_ITEMS, {
      setup: { bi: true, datadog: true },
    });
    expect(grouped.bi.map((i) => i.href)).toEqual(["/ops", "/datadog"]);
    expect(grouped.system.map((i) => i.href)).not.toContain("/ops");
  });
});

describe("filterNavBySetup", () => {
  it("hides all gated items when setup status is unknown", () => {
    const visible = hrefs(filterNavBySetup(ALL_NAV_DESTINATIONS, null));
    expect(visible).not.toContain("/ops");
    expect(visible).not.toContain("/datadog");
    expect(visible).toContain("/"); // ungated items still show
    expect(visible).toContain("/notes");
  });

  it("hides Ops when BI is not configured (plugin nav present)", () => {
    if (!PLUGIN_NAV_ITEMS.some((i) => i.href === "/ops")) return; // skip when BI plugin nav not materialised
    const visible = hrefs(filterNavBySetup(ALL_NAV_DESTINATIONS, { bi: false }));
    expect(visible).not.toContain("/ops");
  });

  it("shows Ops only when BI is configured (plugin nav present)", () => {
    if (!PLUGIN_NAV_ITEMS.some((i) => i.href === "/ops")) return;
    expect(hrefs(filterNavBySetup(ALL_NAV_DESTINATIONS, { bi: true }))).toContain("/ops");
    expect(hrefs(filterNavBySetup(ALL_NAV_DESTINATIONS, {}))).not.toContain("/ops");
  });

  it("gates other integrations independently of Ops", () => {
    const visible = hrefs(filterNavBySetup(ALL_NAV_DESTINATIONS, { datadog: true, bi: false }));
    expect(visible).toContain("/datadog");
    expect(visible).not.toContain("/ops");
  });

  it("hides Datadog when API credentials are not configured", () => {
    expect(hrefs(filterNavBySetup(NAV_ITEMS, { datadog: false }))).not.toContain("/datadog");
    expect(hrefs(filterNavBySetup(NAV_ITEMS, {}))).not.toContain("/datadog");
  });

  it("keeps retired launch destinations out even when installed", () => {
    const shown = hrefs(filterNavBySetup(NAV_ITEMS, { opencode: true }));
    expect(shown).not.toContain("/chamber");
    expect(shown).not.toContain("/opencode");
  });

  it("hides Claude unless it is installed", () => {
    expect(hrefs(filterNavBySetup(NAV_ITEMS, { claude: false }))).not.toContain("/claude");
    expect(hrefs(filterNavBySetup(NAV_ITEMS, {}))).not.toContain("/claude");
  });

  it("keeps Claude in the Agents picker", () => {
    expect(hrefs(filterNavBySetup(NAV_ITEMS, { claude: true }))).not.toContain("/claude");
  });
  it("hides Cursor unless it is installed", () => {
    expect(hrefs(filterNavBySetup(NAV_ITEMS, { cursor: false }))).not.toContain("/cursor");
    expect(hrefs(filterNavBySetup(NAV_ITEMS, {}))).not.toContain("/cursor");
  });
  it("keeps Cursor in the Agents picker", () => {
    expect(hrefs(filterNavBySetup(NAV_ITEMS, { cursor: true }))).not.toContain("/cursor");
  });
  it("hides ChatGPT unless it is installed", () => {
    expect(hrefs(filterNavBySetup(NAV_ITEMS, { chatgpt: false }))).not.toContain("/chatgpt");
    expect(hrefs(filterNavBySetup(NAV_ITEMS, {}))).not.toContain("/chatgpt");
  });
  it("keeps Codex in the Agents picker", () => {
    expect(hrefs(filterNavBySetup(NAV_ITEMS, { chatgpt: true }))).not.toContain("/chatgpt");
  });
  it("hides Antigravity unless it is installed", () => {
    expect(hrefs(filterNavBySetup(NAV_ITEMS, { antigravity: false }))).not.toContain("/antigravity");
    expect(hrefs(filterNavBySetup(NAV_ITEMS, {}))).not.toContain("/antigravity");
  });
  it("keeps Antigravity in the Agents picker", () => {
    expect(hrefs(filterNavBySetup(NAV_ITEMS, { antigravity: true }))).not.toContain("/antigravity");
  });
});

describe("SECTION_TABS", () => {
  it("keeps learnings inside Notes instead of a separate Library tab", () => {
    expect(SECTION_TABS.library.map((t) => t.href)).not.toContain("/learnings");
  });

  it("keeps Setup last on the system strip", () => {
    const system = SECTION_TABS.system.map((t) => t.href);
    expect(system[system.length - 1]).toBe("/setup");
  });

  it("exposes Logs on the system strip for the desktop shell", () => {
    expect(SECTION_TABS.system.map((t) => t.href)).toContain("/logs");
  });
});

describe("activeNavHref", () => {
  const sidebar = NAV_ITEMS.map((i) => i.href);

  it("matches a sidebar row and its sub-routes", () => {
    expect(activeNavHref("/", sidebar)).toBe("/");
    expect(activeNavHref("/notes/a/b.md", sidebar)).toBe("/notes");
    expect(activeNavHref("/repos/devhub", sidebar)).toBe("/repos");
  });

  it("respects segment boundaries", () => {
    expect(activeNavHref("/worker", ["/work"])).toBeUndefined();
  });

  it("lights up the family row for a page reached through section tabs", () => {
    expect(activeNavHref("/docs", sidebar)).toBe("/notes");
    expect(activeNavHref("/diagrams/x", sidebar)).toBe("/notes");
    expect(activeNavHref("/logs", sidebar)).toBe("/status");
    expect(activeNavHref("/setup", sidebar)).toBe("/status");
  });

  it("prefers a page's own row over its family", () => {
    expect(activeNavHref("/search", sidebar)).toBe("/search");
  });

  it("returns nothing for pages with no sidebar home", () => {
    expect(activeNavHref("/recall", sidebar)).toBeUndefined();
  });
});
