export type NavGroup = "workspace" | "library" | "infra" | "system";

export type NavGate = "always" | "calendar" | "github" | "jira" | "datadog" | "infra" | "opencode" | "claude" | "cursor" | "chatgpt" | "antigravity";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  group: NavGroup;
  gate?: NavGate;
  desktopOnly?: boolean;
  sidebar?: boolean;
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

export function sidebarEligibleNav(items: NavItem[], includeDesktopOnly = true): NavItem[] {
  return items.filter((item) => item.sidebar !== false && (includeDesktopOnly || !item.desktopOnly));
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
      sidebarEligibleNav(items, includeDesktopOnly),
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

export const NAV_ITEMS: NavItem[] = [
  { href: "/notifications", label: "Notifications", icon: "bell", group: "workspace", keywords: "Today Inbox Needs you Alerts" },
  { href: "/work", label: "Work", icon: "tasks", group: "workspace", keywords: "Tasks Jira History Storyboard Review" },
  { href: "/repos", label: "Repos", icon: "repos", group: "workspace", keywords: "Changes Send to AI editor pairing" },
  { href: "/notes", label: "Library", icon: "notes", group: "library", keywords: "Notes Docs Learnings Diagrams" },
  { href: "/search", label: "Search", icon: "search", group: "library" },
  { href: "/status", label: "Settings", icon: "setup", group: "system", keywords: "System" },
];

/**
 * Destinations with no sidebar slot that keep working at their URLs. Used for
 * tab titles, breadcrumbs and the ⌘P palette so every page stays one search
 * away.
 *
 * Owned repos live at /repos?view=owned, tasks and Jira at /work. Old
 * redirect-only routes were removed in the slim-core refactor; don't re-add them.
 *
 * Plugin destinations arrive from the reviewed runtime catalogue.
 */
export const LEGACY_NAV_ITEMS: NavItem[] = [
  // Demoted from the sidebar. Each keeps its URL, its old name as a ⌘P search
  // word, and the sidebar row it now lives under (`parent`).
  { href: "/storyboard", label: "Storyboard", icon: "storyboard", group: "workspace", parent: "/work" },
  { href: "/prs", label: "PRs", icon: "prs", group: "workspace", gate: "github", parent: "/work" },
  { href: "/calendar", label: "Calendar", icon: "calendar", group: "workspace", gate: "calendar", parent: "/work" },
  { href: "/review", label: "Weekly review", icon: "review", group: "workspace", keywords: "Review", parent: "/work" },
  // Titled on its own so /review/rep isn't labelled "Weekly review" by prefix.
  { href: "/review/rep", label: "Daily rep", icon: "review", group: "workspace", parent: "/work" },
  { href: "/editor", label: "Editor pairing", icon: "repos", group: "workspace", keywords: "Cursor VS Code Send to AI", parent: "/repos", desktopOnly: true },
  { href: "/skills", label: "Agent skills", icon: "skills", group: "system", keywords: "Skills", parent: "/status" },
  { href: "/qa", label: "QA lab", icon: "review", group: "system", keywords: "QA Jev", parent: "/status" },
  { href: "/agents", label: "Agents", icon: "agents", group: "system" },

  { href: "/db", label: "Databases", icon: "database", group: "infra", desktopOnly: true },
  { href: "/learnings", label: "Learnings", icon: "learnings", group: "library", parent: "/notes" },
  { href: "/voice", label: "My voice", icon: "learnings", group: "library", parent: "/notes" },
  { href: "/recall", label: "Recall", icon: "recall", group: "library", parent: "/search" },
  { href: "/conventions", label: "Conventions", icon: "learnings", group: "library", gate: "github", parent: "/repos" },
  { href: "/radar", label: "Radar", icon: "radar", group: "library", parent: "/repos" },
  { href: "/diagrams", label: "Diagrams", icon: "diagrams", group: "library", parent: "/notes" },
  { href: "/docs", label: "Docs", icon: "docs", group: "library", parent: "/notes" },
  { href: "/shared", label: "Live links", icon: "shared", group: "library", parent: "/notes" },
  { href: "/actions", label: "Actions", icon: "actions", group: "system", desktopOnly: true },
  { href: "/logs", label: "Logs", icon: "status", group: "system", desktopOnly: true },
  { href: "/plugins", label: "Plugins", icon: "skills", group: "system" },
  { href: "/setup", label: "Setup", icon: "setup", group: "system" },
  { href: "/recovery", label: "Backup and recovery", icon: "setup", group: "system", parent: "/status" },
  { href: "/skills/proposals", label: "Skill proposals", icon: "skills", group: "system", parent: "/status" },
];

/** Core destinations; the live catalogue supplies plugin pages. */
export const ALL_NAV_DESTINATIONS: NavItem[] = [
  ...NAV_ITEMS,
  ...LEGACY_NAV_ITEMS,
];

/**
 * The destination that owns a path. The longest href wins, so /review/rep is
 * "Daily rep" rather than "Weekly review". Tab titles, workspace tabs and the
 * palette all name pages through this, which keeps them in step with the sidebar.
 */
export function navDestinationFor(pathname: string, plugin: NavItem[] = []): NavItem | undefined {
  return [...ALL_NAV_DESTINATIONS, ...plugin].filter((item) => matchesNavRoute(pathname, item.href)).sort(
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

export interface PluginNavDestination extends NavItem {
  section?: "library" | "system" | "infra";
}

export function sectionTabs(plugin: PluginNavDestination[] = []): Record<string, SectionTab[]> {
  const tabs = (section: string) => plugin.filter(item => item.section === section);
  return {
    library: mergeSectionTabs(
      [
        // Ordered by measured use (route-usage, 2026-09). Search has its own
        // sidebar slot; Appraisal was ~5 visits, so it lives
        // in ⌘P rather than taking a tab on every Library page.
        { href: "/notes", label: "Notes" },
        { href: "/docs", label: "Docs" },
        { href: "/diagrams", label: "Diagrams" },
        { href: "/shared", label: "Live links", gate: "github" },
        { href: "/radar", label: "Radar" },
      ],
      tabs("library"),
    ),
    system: mergeSectionTabs(
      [
        { href: "/status", label: "Status" },
        { href: "/logs", label: "Logs", desktopOnly: true },
        { href: "/actions", label: "Actions", desktopOnly: true },
        { href: "/plugins", label: "Plugins" },
        { href: "/setup", label: "Setup" },
      ],
      tabs("system"),
    ),
  };
}

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
  const [targetPath, targetQuery] = href.split("?");
  const [currentPath, currentQuery] = pathname.split("?");
  if (targetQuery) {
    const current = new URLSearchParams(currentQuery);
    return currentPath === targetPath && [...new URLSearchParams(targetQuery)].every(([key, value]) => current.get(key) === value);
  }
  if (targetPath === "/") return currentPath === "/";
  return currentPath === targetPath || currentPath.startsWith(`${targetPath}/`);
}

/**
 * Which sidebar row is "you are here". The longest matching href wins; failing
 * that, a demoted page lights up its declared parent. Section tabs without a
 * declared parent (/logs, /actions, …) fall back to their family's sidebar row.
 */
export function activeNavHref(pathname: string, sidebarHrefs: string[], plugin: PluginNavDestination[] = []): string | undefined {
  const direct = sidebarHrefs
    .filter((href) => matchesNavRoute(pathname, href))
    .sort((a, b) => b.length - a.length)[0];
  if (direct) return direct;
  const parent = navDestinationFor(pathname, plugin)?.parent;
  if (parent && sidebarHrefs.includes(parent)) return parent;
  const family = Object.values(sectionTabs(plugin)).find((tabs) =>
    tabs.some((t) => matchesNavRoute(pathname, t.href)),
  );
  const familyHref = family?.find((t) => sidebarHrefs.includes(t.href))?.href;
  return familyHref;
}

/** Core owns runtime page URLs; plugin input never supplies a shell destination. */
export function runtimePageHref(name: string, page: string): string {
  return `/plugins/runtime/${encodeURIComponent(name)}?page=${encodeURIComponent(page)}`;
}
