import { describe, expect, it } from "vitest";
import { ALL_NAV_DESTINATIONS, LEGACY_NAV_ITEMS, NAV_ITEMS, SECTION_TABS, filterNavBySetup } from "./nav";
import { PLUGIN_NAV_ITEMS } from "./plugin-nav.generated";

const hrefs = (items: ReturnType<typeof filterNavBySetup>) => items.map((i) => i.href);

describe("NAV_ITEMS (13-destination IA)", () => {
  it("has exactly 13 sidebar destinations", () => {
    expect(NAV_ITEMS).toHaveLength(13);
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
    expect(hrefs(filterNavBySetup(LEGACY_NAV_ITEMS, { datadog: false }))).not.toContain("/datadog");
    expect(hrefs(filterNavBySetup(LEGACY_NAV_ITEMS, {}))).not.toContain("/datadog");
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
  it("keeps Setup last on the system strip", () => {
    const system = SECTION_TABS.system.map((t) => t.href);
    expect(system[system.length - 1]).toBe("/setup");
  });
});
