import { PLUGIN_NAV_ITEMS, PLUGIN_SECTION_TABS } from "./plugin-nav.generated";

export type NavGroup = "workspace" | "library" | "bi" | "system";

export type NavGate = "always" | "calendar" | "github" | "jira" | "datadog" | "bi" | "chamber" | "opencode" | "claude" | "cursor" | "chatgpt";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  group: NavGroup;
  gate?: NavGate;
  desktopOnly?: boolean;
  /** Keyboard shortcut hint displayed in the sidebar (mono, 9.5px, opacity .6) */
  shortcut?: string;
  /**
   * Not a route — clicking opens this CLI as a terminal-dock tab (see NavLink).
   * Excluded from ALL_NAV_DESTINATIONS; `href` only keys the sidebar row.
   */
  terminal?: "claude" | "cursor" | "chatgpt";
}

export const NAV_GROUPS: { id: NavGroup; label: string }[] = [
  { id: "workspace", label: "Workspace" },
  { id: "library", label: "Library" },
  { id: "bi", label: "BI" },
  { id: "system", label: "System" },
];

/** Empty bucket map for grouping sidebar destinations. */
export function emptyNavGroups(): Record<NavGroup, NavItem[]> {
  return { workspace: [], library: [], bi: [], system: [] };
}

/**
 * Bucket core + plugin destinations for the sidebar / mobile drawer.
 * Plugin items land first within each group so a plugin can own the top of its
 * section (e.g. Ops before Datadog under BI).
 */
export function groupSidebarNav(
  core: NavItem[],
  plugin: NavItem[],
  opts?: { includeDesktopOnly?: boolean; setup?: SetupGateStatus | null },
): Record<NavGroup, NavItem[]> {
  const includeDesktopOnly = opts?.includeDesktopOnly ?? true;
  const setup = opts?.setup ?? null;
  const applicable = (items: NavItem[]) =>
    filterNavBySetup(
      items.filter((i) => includeDesktopOnly || !i.desktopOnly),
      setup,
    );

  const coreMap = emptyNavGroups();
  const pluginMap = emptyNavGroups();
  for (const item of applicable(plugin)) pluginMap[item.group].push(item);
  for (const item of applicable(core)) coreMap[item.group].push(item);

  const merged = emptyNavGroups();
  for (const g of NAV_GROUPS) {
    merged[g.id] = [...pluginMap[g.id], ...coreMap[g.id]];
  }
  return merged;
}

/**
 * Single source of truth for the side nav. Merged concepts:
 *
 * - Work        = Tasks + Tickets (tabs on /work)
 * - Library     = Notes / Docs / Diagrams (tabs over /notes…)
 * - BI          = Ops (plugin) / Datadog — first-class items under a BI group
 * - System      = Status / Logs / Actions / Setup (tabs over /status…)
 * - Search        = unified discovery (exact / ranked / semantic via Recall);
 *                   Recall's graph + ingest controls live at /recall, linked
 *                   from the search page and the ⌘P palette
 *
 * Plugin pages (e.g. /ops) come from `PLUGIN_NAV_ITEMS` (materialised from plugin
 * manifests) and are merged into the sidebar via `groupSidebarNav` — not hand
 * stubs here.
 *
 * The `gate` field controls visibility based on /api/setup/status — pages
 * the user can't actually use yet stay hidden until their integration is
 * configured.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Today", icon: "today", group: "workspace" },
  { href: "/briefing", label: "Briefing", icon: "briefing", group: "workspace" },
  { href: "/calendar", label: "Calendar", icon: "calendar", group: "workspace", gate: "calendar" },
  { href: "/work", label: "Work", icon: "tasks", group: "workspace" },
  { href: "/prs", label: "PRs", icon: "prs", group: "workspace", gate: "github" },
  { href: "/review", label: "Review", icon: "review", group: "workspace", desktopOnly: true },

  { href: "/notes", label: "Notes", icon: "notes", group: "library" },
  { href: "/search", label: "Search", icon: "search", group: "library" },
  { href: "/skills", label: "Skills", icon: "skills", group: "library" },
  { href: "/repos", label: "Repos", icon: "repos", group: "library", desktopOnly: true },
  // Beside Repos, and desktop-only for the same reason: both reach local files
  // and local CLIs. Ungated — SQLite connections need no setup at all, and BI
  // connections simply don't appear without the plugin.
  { href: "/db", label: "Databases", icon: "database", group: "library", desktopOnly: true },

  { href: "/datadog", label: "Datadog", icon: "datadog", group: "bi", gate: "datadog" },

  { href: "/status", label: "System", icon: "status", group: "system" },
  { href: "/chamber", label: "Chamber", icon: "chamber", group: "system", gate: "chamber" },
  { href: "/opencode", label: "OpenCode", icon: "opencode", group: "system", gate: "opencode" },
  { href: "/claude", label: "Claude", icon: "claude", group: "system", gate: "claude", desktopOnly: true, terminal: "claude" },
  { href: "/cursor", label: "Cursor", icon: "cursor", group: "system", gate: "cursor", desktopOnly: true, terminal: "cursor" },
  { href: "/chatgpt", label: "ChatGPT", icon: "chatgpt", group: "system", gate: "chatgpt", desktopOnly: true, terminal: "chatgpt" },
];

/**
 * Destinations that lost their sidebar slot in the 11-item IA but keep
 * working at their URLs. Used for breadcrumbs and the ⌘P palette so every
 * page stays one search away.
 *
 * /own redirects to /repos?view=owned — ownership radar lives on Repos, not
 * a competing sidebar destination.
 *
 * Plugin-contributed destinations live in PLUGIN_NAV_ITEMS (not here).
 * /tasks and /tickets redirect forever to /work — do not re-add them.
 */
export const LEGACY_NAV_ITEMS: NavItem[] = [
  { href: "/own", label: "Owned repos", icon: "own", group: "library", gate: "github" },
  { href: "/appraisal", label: "Appraisal", icon: "review", group: "library" },
  { href: "/one-on-one", label: "1:1", icon: "review", group: "library" },
  { href: "/research", label: "Research", icon: "learnings", group: "library" },
  { href: "/learnings", label: "Learnings", icon: "learnings", group: "library" },
  { href: "/recall", label: "Recall", icon: "recall", group: "library" },
  { href: "/radar", label: "Radar", icon: "radar", group: "library" },
  { href: "/diagrams", label: "Diagrams", icon: "diagrams", group: "library" },
  { href: "/docs", label: "Docs", icon: "docs", group: "library" },
  { href: "/shared", label: "Live links", icon: "shared", group: "library", gate: "github" },
  { href: "/actions", label: "Actions", icon: "actions", group: "system", desktopOnly: true },
  { href: "/logs", label: "Logs", icon: "status", group: "system", desktopOnly: true },
  { href: "/setup", label: "Setup", icon: "setup", group: "system" },
];

/** Every routable destination — sidebar items first, then legacy + plugin pages.
 *  Terminal-launch rows (Claude/Cursor/ChatGPT) have no page behind them. */
export const ALL_NAV_DESTINATIONS: NavItem[] = [
  ...NAV_ITEMS.filter((i) => !i.terminal),
  ...LEGACY_NAV_ITEMS,
  ...PLUGIN_NAV_ITEMS,
];

/** Tabs rendered in the top bar when inside a merged destination. */
export interface SectionTab {
  href: string;
  label: string;
  gate?: NavGate;
  desktopOnly?: boolean;
}

function mergeSectionTabs(core: SectionTab[], plugin: SectionTab[] | undefined): SectionTab[] {
  if (!plugin?.length) return core;
  const seen = new Set(core.map((t) => t.href));
  const extras = plugin.filter((t) => !seen.has(t.href));
  // Keep Setup last when present; insert plugin tabs before it.
  const setupIdx = core.findIndex((t) => t.href === "/setup");
  if (setupIdx === -1) return [...core, ...extras];
  return [...core.slice(0, setupIdx), ...extras, ...core.slice(setupIdx)];
}

export const SECTION_TABS: Record<string, SectionTab[]> = {
  library: mergeSectionTabs(
    [
      { href: "/notes", label: "Notes" },
      { href: "/search", label: "Search" },
      { href: "/docs", label: "Docs" },
      { href: "/radar", label: "Radar" },
      { href: "/appraisal", label: "Appraisal" },
      { href: "/research", label: "Research" },
      { href: "/diagrams", label: "Diagrams" },
      { href: "/shared", label: "Live links", gate: "github" },
    ],
    PLUGIN_SECTION_TABS.library,
  ),
  system: mergeSectionTabs(
    [
      { href: "/status", label: "Status" },
      { href: "/logs", label: "Logs", desktopOnly: true },
      { href: "/actions", label: "Actions", desktopOnly: true },
      { href: "/setup", label: "Setup" },
    ],
    PLUGIN_SECTION_TABS.system,
  ),
};

export interface SetupGateStatus {
  github?: boolean;
  datadog?: boolean;
  calendar?: boolean;
  jira?: boolean;
  bi?: boolean;
  chamber?: boolean;
  opencode?: boolean;
  claude?: boolean;
  cursor?: boolean;
  chatgpt?: boolean;
}

export function gateAllows(gate: NavGate | undefined, setup: SetupGateStatus | null): boolean {
  if (!gate || gate === "always") return true;
  if (!setup) return false;
  return setup[gate] === true;
}

export function filterNavBySetup(items: NavItem[], setup: SetupGateStatus | null): NavItem[] {
  return items.filter((i) => gateAllows(i.gate, setup));
}

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Group crumbs come from NAV_GROUPS — the same list the sidebar renders — so
 * the two can't disagree. They did: the top bar used to hold its own copy that
 * labelled the Library group "Notes", so all fourteen Library destinations
 * breadcrumbed as "Notes › Repos", "Notes › Skills", "Notes › Own"…
 *
 * This lives in lib rather than in the top bar because it is pure routing
 * data: importing the component to test it drags in xterm's stylesheet.
 */
const ROOT_LABEL = Object.fromEntries(
  NAV_GROUPS.map((g) => [g.id, g.label]),
) as Record<NavGroup, string>;

/** Landing page for each nav family — makes the group crumb clickable. */
const ROOT_HREF: Record<NavGroup, string> = {
  workspace: "/",
  library: "/notes",
  bi: "/ops",
  system: "/status",
};

export function buildCrumbs(pathname: string): Crumb[] {
  const item = ALL_NAV_DESTINATIONS.find((n) =>
    n.href === "/" ? pathname === "/" : pathname.startsWith(n.href),
  );
  if (!item) return [{ label: "Workspace" }, { label: pathname }];
  const groupLabel = ROOT_LABEL[item.group] ?? "Workspace";
  const rootHref = ROOT_HREF[item.group];
  // On a group's own landing page, don't repeat it ("Notes › Notes").
  if (item.href === rootHref) return [{ label: item.label }];
  return [{ label: groupLabel, href: rootHref }, { label: item.label }];
}
