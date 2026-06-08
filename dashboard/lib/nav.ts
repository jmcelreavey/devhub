export type NavGroup = "workspace" | "library" | "system";

export type NavGate = "always" | "calendar" | "github" | "jira" | "datadog" | "bi" | "chamber" | "opencode";

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
 * Single source of truth for the side nav. ⌘K remains the quick palette;
 * /search is the full vault search page. Learnings has its own page while
 * still living under notes/learnings/ in the vault.
 *
 * The `gate` field controls visibility based on /api/setup/status — pages
 * the user can't actually use yet stay hidden until their integration is
 * configured.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Today", icon: "today", group: "workspace" },
  { href: "/calendar", label: "Calendar", icon: "calendar", group: "workspace", gate: "calendar" },
  { href: "/tickets", label: "Tickets", icon: "tickets", group: "workspace", gate: "jira" },
  { href: "/tasks", label: "Tasks", icon: "tasks", group: "workspace" },
  { href: "/review", label: "Review", icon: "review", group: "workspace", desktopOnly: true },
  { href: "/prs", label: "PRs", icon: "prs", group: "workspace", gate: "github" },

  { href: "/notes", label: "Notes", icon: "notes", group: "library" },
  { href: "/search", label: "Search", icon: "search", group: "library" },
  { href: "/learnings", label: "Learnings", icon: "learnings", group: "library" },
  { href: "/diagrams", label: "Diagrams", icon: "diagrams", group: "library" },
  { href: "/skills", label: "Agents", icon: "skills", group: "library" },
  { href: "/repos", label: "Repos", icon: "repos", group: "library", desktopOnly: true },
  { href: "/docs", label: "Docs", icon: "docs", group: "library" },
  { href: "/shared", label: "Live links", icon: "shared", group: "library", gate: "github" },

  { href: "/status", label: "Status", icon: "status", group: "system" },
  { href: "/ops", label: "Ops", icon: "ops", group: "system", gate: "bi" },
  { href: "/datadog", label: "Datadog", icon: "datadog", group: "system", gate: "datadog" },
  { href: "/actions", label: "Actions", icon: "actions", group: "system", desktopOnly: true },
  { href: "/chamber", label: "Chamber", icon: "chamber", group: "system", gate: "chamber" },
  { href: "/opencode", label: "OpenCode", icon: "opencode", group: "system", gate: "opencode" },
  { href: "/setup", label: "Setup", icon: "setup", group: "system" },
];

export interface SetupGateStatus {
  github?: boolean;
  datadog?: boolean;
  calendar?: boolean;
  jira?: boolean;
  bi?: boolean;
  chamber?: boolean;
  opencode?: boolean;
}

export function filterNavBySetup(items: NavItem[], setup: SetupGateStatus | null): NavItem[] {
  if (!setup) return items.filter((i) => !i.gate);
  return items.filter((i) => {
    if (!i.gate || i.gate === "always") return true;
    if (i.gate === "calendar") return setup.calendar === true;
    if (i.gate === "github") return setup.github === true;
    if (i.gate === "jira") return setup.jira === true;
    if (i.gate === "datadog") return setup.datadog === true;
    if (i.gate === "bi") return setup.bi === true;
    if (i.gate === "chamber") return setup.chamber === true;
    if (i.gate === "opencode") return setup.opencode === true;
    return true;
  });
}
