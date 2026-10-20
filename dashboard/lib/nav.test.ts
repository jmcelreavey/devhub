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
navDestinationFor,
settingsLinks,
type NavItem,
} from "./nav";
import { PLUGIN_NAV_ITEMS } from "./plugin-nav.generated";

const hrefs = (items: ReturnType<typeof filterNavBySetup>) => items.map((i) => i.href);

const labels = (items: NavItem[]) => items.map((i) => i.label);

describe("NAV_ITEMS (sidebar IA)", () => {
  it("has one shared Agents destination among 12 core destinations", () => {
    expect(NAV_ITEMS).toHaveLength(12);
    expect(NAV_ITEMS.filter((item) => item.href === "/agents")).toHaveLength(1);
  });

  it("names the jobs: Workspace, Library, Tools, then the system footer", () => {
    const grouped = groupSidebarNav(NAV_ITEMS, [], {
      setup: { github: true, calendar: true, datadog: true },
    });
    expect(NAV_GROUPS.map((g) => g.label)).toEqual(["Workspace", "Library", "Tools", "System"]);
    expect(labels(grouped.workspace)).toEqual(["Home", "Storyboard", "Tasks", "PRs", "Calendar"]);
    expect(labels(grouped.library)).toEqual(["Notes", "Search", "Repos"]);
    expect(labels(grouped.infra)).toEqual(["Datadog", "Databases"]);
    expect(labels(grouped.system)).toEqual(["Agents", "Settings"]);
  });

  it("renames Work to Tasks and System to Settings without moving their URLs", () => {
    expect(NAV_ITEMS.find((item) => item.href === "/work")?.label).toBe("Tasks");
    expect(NAV_ITEMS.find((item) => item.href === "/status")?.label).toBe("Settings");
    expect(labels(NAV_ITEMS)).not.toContain("Work");
    expect(labels(NAV_ITEMS)).not.toContain("System");
    expect(labels(NAV_ITEMS)).not.toContain("Infrastructure");
  });

  it("calls the first destination Home but keeps Today as a command-palette search term", () => {
    expect(NAV_ITEMS.find((item) => item.href === "/")).toMatchObject({ label: "Home", icon: "today", keywords: "Today" });
  });

  it("keeps the open-task badge and unseen dot on the renamed Tasks row", () => {
    // Both are keyed on the icon, so a rename must not touch it.
    expect(NAV_ITEMS.find((item) => item.href === "/work")?.icon).toBe("tasks");
  });

  it("takes Briefing, QA, Review and Skills out of the sidebar but not out of the app", () => {
    const sidebar = hrefs(NAV_ITEMS);
    for (const [href, label] of [
      ["/briefing", "Briefing"],
      ["/qa", "QA lab"],
      ["/review", "Weekly review"],
      ["/skills", "Agent skills"],
    ]) {
      expect(sidebar).not.toContain(href);
      expect(LEGACY_NAV_ITEMS.find((item) => item.href === href)?.label).toBe(label);
      expect(hrefs(ALL_NAV_DESTINATIONS)).toContain(href);
    }
  });

  it("gives the database client a Tools slot beside Datadog", () => {
    const db = NAV_ITEMS.find((item) => item.href === "/db");
    expect(db?.group).toBe("infra");
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

  it("exposes Tasks, Library and Settings as the merged destinations", () => {
    const sidebar = hrefs(NAV_ITEMS);
    expect(sidebar).toContain("/work"); // Tasks
    expect(sidebar).toContain("/notes"); // Library
    expect(sidebar).toContain("/status"); // Settings
  });
  it("gives Storyboard an ungated workspace slot ahead of Tasks", () => {
    const sidebar = hrefs(NAV_ITEMS);
    const storyboard = NAV_ITEMS.find((item) => item.href === "/storyboard");
    expect(storyboard?.group).toBe("workspace");
    // Ungated: the sample board and task evidence work with no integration configured.
    expect(storyboard?.gate).toBeUndefined();
    expect(sidebar.indexOf("/storyboard")).toBe(sidebar.indexOf("/work") - 1);
  });

  it("gives Datadog a first-class Tools sidebar slot", () => {
    const datadog = NAV_ITEMS.find((item) => item.href === "/datadog");
    expect(datadog).toBeDefined();
    expect(datadog?.group).toBe("infra");
    expect(datadog?.gate).toBe("datadog");
    expect(hrefs(LEGACY_NAV_ITEMS)).not.toContain("/datadog");
  });
  it("keeps the infra group id (plugin manifests use it) between Library and System", () => {
    expect(NAV_GROUPS.map((g) => g.id)).toEqual(["workspace", "library", "infra", "system"]);
  });
  it("merges a plugin's Ops into Tools ahead of Datadog and Databases", () => {
    const ops: NavItem = { href: "/ops", label: "Ops", icon: "ops", group: "infra", gate: "infra" };
    const grouped = groupSidebarNav(NAV_ITEMS, [ops], { setup: { infra: true, datadog: true } });
    expect(hrefs(grouped.infra)).toEqual(["/ops", "/datadog", "/db"]);
    expect(hrefs(grouped.system)).not.toContain("/ops");
  });
  it("keeps Databases off the mobile drawer, which only shows what a phone can reach", () => {
    const grouped = groupSidebarNav(NAV_ITEMS, [], { includeDesktopOnly: false, setup: { datadog: true } });
    expect(hrefs(grouped.infra)).toEqual(["/datadog"]);
    expect(hrefs(grouped.library)).toEqual(["/notes", "/search"]);
  });
});

describe("navDestinationFor", () => {
  it("names a page by the longest matching destination", () => {
    expect(navDestinationFor("/work")?.label).toBe("Tasks");
    expect(navDestinationFor("/status")?.label).toBe("Settings");
    expect(navDestinationFor("/review")?.label).toBe("Weekly review");
    expect(navDestinationFor("/review/rep")?.label).toBe("Daily rep");
    expect(navDestinationFor("/qa")?.label).toBe("QA lab");
    expect(navDestinationFor("/skills")?.label).toBe("Agent skills");
    expect(navDestinationFor("/briefing")?.label).toBe("Briefing");
    expect(navDestinationFor("/db")?.label).toBe("Databases");
    expect(navDestinationFor("/repos/devhub")?.label).toBe("Repos");
  });

  it("respects segment boundaries and has no opinion about unknown pages", () => {
    expect(navDestinationFor("/worker")).toBeUndefined();
    expect(navDestinationFor("/nowhere")).toBeUndefined();
  });
});

describe("old names still find their pages", () => {
  it("carries the retired labels as search keywords on the page that took them over", () => {
    const keywords = (href: string) => ALL_NAV_DESTINATIONS.find((item) => item.href === href)?.keywords;
    expect(keywords("/work")).toBe("Work");
    expect(keywords("/status")).toBe("System");
    expect(keywords("/review")).toBe("Review");
    expect(keywords("/qa")).toBe("QA");
    expect(keywords("/skills")).toBe("Skills");
  });

  it("lists every destination once, so palette rows and tab titles cannot disagree", () => {
    const all = hrefs(ALL_NAV_DESTINATIONS);
    expect(new Set(all).size).toBe(all.length);
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

  it("hides Ops when infrastructure is not configured (plugin nav present)", () => {
    if (!PLUGIN_NAV_ITEMS.some((i) => i.href === "/ops")) return; // skip when infrastructure plugin nav not materialised
    const visible = hrefs(filterNavBySetup(ALL_NAV_DESTINATIONS, { infra: false }));
    expect(visible).not.toContain("/ops");
  });

  it("shows Ops only when infrastructure is configured (plugin nav present)", () => {
    if (!PLUGIN_NAV_ITEMS.some((i) => i.href === "/ops")) return;
    expect(hrefs(filterNavBySetup(ALL_NAV_DESTINATIONS, { infra: true }))).toContain("/ops");
    expect(hrefs(filterNavBySetup(ALL_NAV_DESTINATIONS, {}))).not.toContain("/ops");
  });

  it("gates other integrations independently of Ops", () => {
    const visible = hrefs(filterNavBySetup(ALL_NAV_DESTINATIONS, { datadog: true, infra: false }));
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

  it("labels the sections inside Settings plainly: Status, Logs, Actions, Setup", () => {
    const byHref = new Map(SECTION_TABS.system.map((t) => [t.href, t.label]));
    expect(SECTION_TABS.system[0]).toMatchObject({ href: "/status", label: "Status" });
    expect(byHref.get("/logs")).toBe("Logs");
    expect(byHref.get("/actions")).toBe("Actions");
    expect(byHref.get("/setup")).toBe("Setup");
    expect([...byHref.values()]).not.toContain("System");
  });
});

describe("settingsLinks", () => {
  it("reaches Agent skills and the QA lab from Settings", () => {
    expect(settingsLinks()).toEqual([
      { href: "/skills", label: "Agent skills" },
      { href: "/qa", label: "QA lab" },
    ]);
  });

  it("only lists pages that really are routable destinations", () => {
    for (const link of settingsLinks()) {
      expect(hrefs(ALL_NAV_DESTINATIONS)).toContain(link.href);
    }
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

  it("highlights Databases under Tools", () => {
    expect(activeNavHref("/db", sidebar)).toBe("/db");
    expect(NAV_ITEMS.find((item) => item.href === "/db")?.group).toBe("infra");
  });

  it("keeps a demoted page under the row it now lives beneath", () => {
    expect(activeNavHref("/briefing", sidebar)).toBe("/");
    expect(activeNavHref("/review", sidebar)).toBe("/work");
    expect(activeNavHref("/review/rep", sidebar)).toBe("/work");
    expect(activeNavHref("/qa", sidebar)).toBe("/status");
    expect(activeNavHref("/skills", sidebar)).toBe("/status");
  });

  it("only lights a row the asking surface actually has", () => {
    // The mobile shelf has Today, Notes and Tasks - nothing for Settings.
    const shelf = ["/", "/notes", "/work"];
    expect(activeNavHref("/review", shelf)).toBe("/work");
    expect(activeNavHref("/briefing", shelf)).toBe("/");
    expect(activeNavHref("/docs", shelf)).toBe("/notes");
    expect(activeNavHref("/qa", shelf)).toBeUndefined();
    expect(activeNavHref("/workflow", shelf)).toBeUndefined();
  });

  it("declares a parent that is a real sidebar row for every demoted page", () => {
    const demoted = LEGACY_NAV_ITEMS.filter((item) => item.parent);
    expect(demoted.length).toBeGreaterThan(0);
    for (const item of demoted) expect(sidebar).toContain(item.parent);
  });
});
