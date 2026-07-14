import { PLUGIN_NAV_ITEMS, PLUGIN_SECTION_TABS } from "./plugin-nav.generated";

export type NavGroup = "workspace" | "library" | "system";

export type NavGate = "always" | "calendar" | "github" | "jira" | "datadog" | "bi" | "chamber" | "opencode" | "claude";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  group: NavGroup;
  gate?: NavGate;
  desktopOnly?: boolean;
  /** Keyboard shortcut hint displayed in the sidebar (mono, 9.5px, opacity .6) */
  shortcut?: string;
}

export const NAV_GROUPS: { id: NavGroup; label: string }[] = [
  { id: "workspace", label: "Workspace" },
  { id: "library", label: "Library" },
  { id: "system", label: "System" },
];

/**
 * Single source of truth for the side nav — 12 destinations (2026-06 IA,
 * see docs/codebase-review-2026-06-09.md). Merged concepts:
 *
 * - Work        = Tasks + Tickets (tabs on /work)
 * - Library     = Notes / Docs / Learnings / Diagrams (tabs over /notes…)
 * - System      = Status / Ops / Datadog / Actions / Setup (tabs over /status…)
 * - Search page → ⌘K palette
 *
 * Plugin pages (e.g. /ops) come from `PLUGIN_NAV_ITEMS` (materialised from plugin
 * manifests) — not hand stubs here.
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

  { href: "/notes", label: "Library", icon: "notes", group: "library" },
  { href: "/skills", label: "Agents", icon: "skills", group: "library" },
  { href: "/repos", label: "Repos", icon: "repos", group: "library", desktopOnly: true },

  { href: "/status", label: "System", icon: "status", group: "system" },
  { href: "/chamber", label: "Chamber", icon: "chamber", group: "system", gate: "chamber" },
  { href: "/opencode", label: "OpenCode", icon: "opencode", group: "system", gate: "opencode" },
  { href: "/claude", label: "Claude", icon: "claude", group: "system", gate: "claude", desktopOnly: true },
];

/**
 * Destinations that lost their sidebar slot in the 11-item IA but keep
 * working at their URLs. Used for breadcrumbs and the ⌘K palette so every
 * page stays one search away.
 *
 * Plugin-contributed destinations live in PLUGIN_NAV_ITEMS (not here).
 * /tasks and /tickets redirect forever to /work — do not re-add them.
 */
export const LEGACY_NAV_ITEMS: NavItem[] = [
  { href: "/appraisal", label: "Appraisal", icon: "review", group: "library" },
  { href: "/one-on-one", label: "1:1", icon: "review", group: "library" },
  { href: "/research", label: "Research", icon: "learnings", group: "library" },
  { href: "/search", label: "Search", icon: "search", group: "library" },
  { href: "/learnings", label: "Learnings", icon: "learnings", group: "library" },
  { href: "/radar", label: "Radar", icon: "radar", group: "library" },
  { href: "/diagrams", label: "Diagrams", icon: "diagrams", group: "library" },
  { href: "/docs", label: "Docs", icon: "docs", group: "library" },
  { href: "/shared", label: "Live links", icon: "shared", group: "library", gate: "github" },
  { href: "/datadog", label: "Datadog", icon: "datadog", group: "system", gate: "datadog" },
  { href: "/actions", label: "Actions", icon: "actions", group: "system", desktopOnly: true },
  { href: "/setup", label: "Setup", icon: "setup", group: "system" },
];

/** Every routable destination — sidebar items first, then legacy + plugin pages. */
export const ALL_NAV_DESTINATIONS: NavItem[] = [
  ...NAV_ITEMS,
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
      { href: "/docs", label: "Docs" },
      { href: "/learnings", label: "Learnings" },
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
      { href: "/datadog", label: "Datadog", gate: "datadog" },
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
}

export function gateAllows(gate: NavGate | undefined, setup: SetupGateStatus | null): boolean {
  if (!gate || gate === "always") return true;
  if (!setup) return false;
  return setup[gate] === true;
}

export function filterNavBySetup(items: NavItem[], setup: SetupGateStatus | null): NavItem[] {
  return items.filter((i) => gateAllows(i.gate, setup));
}
