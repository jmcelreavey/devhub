import { PLUGIN_NAV_ITEMS,PLUGIN_SECTION_TABS } from "./plugin-nav.generated";

export type NavGroup = "workspace" | "library" | "infra" | "system";

export type NavGate = "always" | "calendar" | "github" | "jira" | "datadog" | "infra" | "opencode" | "claude" | "cursor" | "chatgpt" | "antigravity";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  group: NavGroup;
  gate?: NavGate;
  desktopOnly?: boolean;
  /** Keyboard shortcut hint displayed in the sidebar (mono, 9.5px, opacity .6) */
  shortcut?: string;
  /** Extra ⌘P search words, never shown: the name a renamed page used to go by. */
  keywords?: string;
  /** Sidebar row that lights up on a page with no row of its own. */
  parent?: string;
}

export const NAV_GROUPS: { id: NavGroup; label: string }[] = [
  { id: "workspace", label: "Workspace" },
  { id: "library", label: "Library" },
  // The id stays "infra": plugin manifests declare `group: "infra"`.
  { id: "infra", label: "Tools" },
  { id: "system", label: "System" },
];

/** Empty bucket map for grouping sidebar destinations. */
export function emptyNavGroups(): Record<NavGroup, NavItem[]> {
  return { workspace: [], library: [], infra: [], system: [] };
}

/**
 * Bucket core + plugin destinations for the sidebar / mobile drawer.
 * Plugin items land first within each group so a plugin can own the top of its
 * section (e.g. Ops before Datadog under Tools).
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
 * - Tasks       = Tasks + Jira + History (tabs on /work; the URL predates the name)
 * - Library     = Notes / Docs / Diagrams (tabs over /notes…)
 * - Tools       = Ops (plugin) / Datadog / Databases — the `infra` group
 * - Settings    = Status / Logs / Actions / Setup (tabs over /status…); Agent skills
 *                 and the QA lab hang off it as links (see `settingsLinks`)
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
  { href: "/", label: "Home", icon: "today", group: "workspace", keywords: "Today" },
  { href: "/storyboard", label: "Storyboard", icon: "storyboard", group: "workspace" },
  // The icon key drives the open-task badge, so it stays "tasks" through the rename.
  { href: "/work", label: "Tasks", icon: "tasks", group: "workspace", keywords: "Work" },
  { href: "/prs", label: "PRs", icon: "prs", group: "workspace", gate: "github" },
  { href: "/calendar", label: "Calendar", icon: "calendar", group: "workspace", gate: "calendar" },

  { href: "/notes", label: "Notes", icon: "notes", group: "library" },
  { href: "/search", label: "Search", icon: "search", group: "library" },
  { href: "/repos", label: "Repos", icon: "repos", group: "library", desktopOnly: true },

  { href: "/datadog", label: "Datadog", icon: "datadog", group: "infra", gate: "datadog" },
  // Desktop-only like Repos: both reach local files and local CLIs. Ungated —
  // SQLite connections need no setup at all, and infrastructure connections
  // simply don't appear without the plugin.
  { href: "/db", label: "Databases", icon: "database", group: "infra", desktopOnly: true },

  { href: "/agents", label: "Agents", icon: "agents", group: "system" },
  { href: "/status", label: "Settings", icon: "setup", group: "system", keywords: "System" },
];

/**
 * Destinations with no sidebar slot that keep working at their URLs. Used for
 * tab titles, breadcrumbs and the ⌘P palette so every page stays one search
 * away.
 *
 * /own redirects to /repos?view=owned — ownership radar lives on Repos, not
 * a competing sidebar destination.
 *
 * Plugin-contributed destinations live in PLUGIN_NAV_ITEMS (not here).
 * /tasks and /tickets redirect forever to /work — do not re-add them.
 */
export const LEGACY_NAV_ITEMS: NavItem[] = [
  // Demoted from the sidebar. Each keeps its URL, its old name as a ⌘P search
  // word, and the sidebar row it now lives under (`parent`).
  { href: "/briefing", label: "Briefing", icon: "briefing", group: "workspace", parent: "/" },
  { href: "/review", label: "Weekly review", icon: "review", group: "workspace", keywords: "Review", parent: "/work" },
  // Titled on its own so /review/rep isn't labelled "Weekly review" by prefix.
  { href: "/review/rep", label: "Daily rep", icon: "review", group: "workspace", parent: "/work" },
  { href: "/skills", label: "Agent skills", icon: "skills", group: "system", keywords: "Skills", parent: "/status" },
  { href: "/qa", label: "QA lab", icon: "review", group: "system", keywords: "QA", parent: "/status" },

  { href: "/own", label: "Owned repos", icon: "own", group: "library", gate: "github" },
  { href: "/appraisal", label: "Appraisal", icon: "review", group: "library" },
  { href: "/one-on-one", label: "1:1", icon: "review", group: "library" },
  { href: "/research", label: "Research", icon: "learnings", group: "library" },
  { href: "/learnings", label: "Learnings", icon: "learnings", group: "library" },
  { href: "/voice", label: "My voice", icon: "learnings", group: "library" },
  { href: "/recall", label: "Recall", icon: "recall", group: "library" },
  { href: "/conventions", label: "Conventions", icon: "learnings", group: "library", gate: "github" },
  { href: "/radar", label: "Radar", icon: "radar", group: "library" },
  { href: "/diagrams", label: "Diagrams", icon: "diagrams", group: "library" },
  { href: "/docs", label: "Docs", icon: "docs", group: "library" },
  { href: "/shared", label: "Live links", icon: "shared", group: "library", gate: "github" },
  { href: "/actions", label: "Actions", icon: "actions", group: "system", desktopOnly: true },
  { href: "/logs", label: "Logs", icon: "status", group: "system", desktopOnly: true },
  { href: "/plugins", label: "Plugins", icon: "skills", group: "system" },
  { href: "/integrations", label: "Integrations", icon: "setup", group: "system" },
  { href: "/browser", label: "Browser", icon: "setup", group: "system" },
  { href: "/setup", label: "Setup", icon: "setup", group: "system" },
];

/** Every routable destination — sidebar items first, then legacy + plugin pages. */
export const ALL_NAV_DESTINATIONS: NavItem[] = [
  ...NAV_ITEMS,
  ...LEGACY_NAV_ITEMS,
  ...PLUGIN_NAV_ITEMS,
];

/**
 * The destination that owns a path. The longest href wins, so /review/rep is
 * "Daily rep" rather than "Weekly review". Tab titles, workspace tabs and the
 * palette all name pages through this, which keeps them in step with the sidebar.
 */
export function navDestinationFor(pathname: string): NavItem | undefined {
  return ALL_NAV_DESTINATIONS.filter((item) => matchesNavRoute(pathname, item.href)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
}

/**
 * Pages that live under Settings without a top-bar tab. The System strip is
 * already as wide as the bar allows, so these are links on the Settings page.
 */
export function settingsLinks(): { href: string; label: string }[] {
  return LEGACY_NAV_ITEMS.filter((item) => item.parent === "/status").map(({ href, label }) => ({ href, label }));
}

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
      // Ordered by measured use (route-usage, 2026-09). Search has its own
      // sidebar slot; Appraisal and Research were ~5 visits each, so they live
      // in ⌘P rather than taking a tab on every Library page.
      { href: "/notes", label: "Notes" },
      { href: "/docs", label: "Docs" },
      { href: "/diagrams", label: "Diagrams" },
      { href: "/shared", label: "Live links", gate: "github" },
      { href: "/radar", label: "Radar" },
    ],
    PLUGIN_SECTION_TABS.library,
  ),
  system: mergeSectionTabs(
    [
      { href: "/status", label: "Status" },
      { href: "/logs", label: "Logs", desktopOnly: true },
      { href: "/actions", label: "Actions", desktopOnly: true },
      { href: "/plugins", label: "Plugins" },
      { href: "/integrations", label: "Integrations" },
      { href: "/browser", label: "Browser" },
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
  infra?: boolean;
  opencode?: boolean;
  claude?: boolean;
  cursor?: boolean;
  chatgpt?: boolean;
  antigravity?: boolean;
  /** Wizard reached All set. Optional gates that were skipped are not unfinished work. */
  completed?: boolean;
}

export function gateAllows(gate: NavGate | undefined, setup: SetupGateStatus | null): boolean {
  if (!gate || gate === "always") return true;
  if (!setup) return false;
  return setup[gate] === true;
}

export function filterNavBySetup(items: NavItem[], setup: SetupGateStatus | null): NavItem[] {
  return items.filter((i) => gateAllows(i.gate, setup));
}

export function matchesNavRoute(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Which sidebar row is "you are here". The longest matching href wins; failing
 * that, a page reached through a section tab (/docs, /logs, …) lights up its
 * family's sidebar entry (Notes, Settings) — otherwise the sidebar shows no
 * position at all on half the Library and Settings pages. Last, a demoted page
 * (/review, /qa, …) lights up the row it declares as its `parent`, when the
 * surface asking has that row (the mobile shelf has three).
 */
export function activeNavHref(pathname: string, sidebarHrefs: string[]): string | undefined {
  const direct = sidebarHrefs
    .filter((href) => matchesNavRoute(pathname, href))
    .sort((a, b) => b.length - a.length)[0];
  if (direct) return direct;
  const family = Object.values(SECTION_TABS).find((tabs) =>
    tabs.some((t) => matchesNavRoute(pathname, t.href)),
  );
  const familyHref = family?.find((t) => sidebarHrefs.includes(t.href))?.href;
  if (familyHref) return familyHref;
  const parent = navDestinationFor(pathname)?.parent;
  return parent && sidebarHrefs.includes(parent) ? parent : undefined;
}
