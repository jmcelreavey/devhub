import { describe, expect, it } from "vitest";
import {
  ALL_NAV_DESTINATIONS,
  LEGACY_NAV_ITEMS,
  NAV_GROUPS,
  NAV_ITEMS,
  SECTION_TABS,
  filterNavBySetup,
  groupSidebarNav,
} from "./nav";
import { PLUGIN_NAV_ITEMS } from "./plugin-nav.generated";

const hrefs = (items: ReturnType<typeof filterNavBySetup>) => items.map((i) => i.href);

describe("NAV_ITEMS (sidebar IA)", () => {
  it("has exactly 16 core sidebar destinations", () => {
    expect(NAV_ITEMS).toHaveLength(16);
  });

  it("gives owned repositories a repo-centric destination", () => {
    expect(NAV_ITEMS.find((item) => item.href === "/own")?.group).toBe("library");
  });

  it("gives Recall a sidebar slot in the library group", () => {
    const recall = NAV_ITEMS.find((item) => item.href === "/recall");
    expect(recall).toBeDefined();
    expect(recall?.group).toBe("library");
    // Ungated on purpose: recall works with zero integrations configured, so
    // hiding it behind a setup gate would hide the one page that is useful on
    // a fresh machine.
    expect(recall?.gate).toBeUndefined();
  });

  it("keeps merged pages out of the sidebar but in the destination list", () => {
    const sidebar = hrefs(NAV_ITEMS);
    for (const legacy of ["/search", "/docs", "/learnings", "/diagrams", "/setup"]) {
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

  it("hides Chamber and OpenCode when peer services are unavailable", () => {
    const hidden = hrefs(filterNavBySetup(NAV_ITEMS, { chamber: false, opencode: false }));
    expect(hidden).not.toContain("/chamber");
    expect(hidden).not.toContain("/opencode");
  });

  it("shows Chamber and OpenCode only when gated on", () => {
    expect(hrefs(filterNavBySetup(NAV_ITEMS, { chamber: true }))).toContain("/chamber");
    expect(hrefs(filterNavBySetup(NAV_ITEMS, { opencode: true }))).toContain("/opencode");
  });

  it("hides Claude unless it is installed", () => {
    expect(hrefs(filterNavBySetup(NAV_ITEMS, { claude: false }))).not.toContain("/claude");
    expect(hrefs(filterNavBySetup(NAV_ITEMS, {}))).not.toContain("/claude");
  });

  it("shows Claude only when installed", () => {
    expect(hrefs(filterNavBySetup(NAV_ITEMS, { claude: true }))).toContain("/claude");
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
