"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Monitor, Search, Settings, Terminal } from "lucide-react";
import { ALL_NAV_DESTINATIONS, type NavGroup } from "@/lib/nav";
import { SectionTabs } from "./SectionTabs";
import { AccentPicker } from "./AccentPicker";
import { ThemeToggle } from "./ThemeToggle";
import { FocusTimer } from "./FocusTimer";
import { NotesBrowseButton } from "./NotesBrowseButton";
import { TasksBrowseButton } from "./TasksBrowseButton";
import { DiagramsBrowseButton } from "./DiagramsBrowseButton";
import { ContentSyncIndicator } from "./ContentSyncIndicator";
import { TerminalDockButton } from "./TerminalDock";
import { useLaunchChamberDesktop } from "@/lib/launch-chamber";
import { useLaunchOpenCodeDesktop } from "@/lib/launch-opencode";

const CLUSTER_STYLE: React.CSSProperties = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border-muted)",
};

interface Crumb {
  label: string;
  href?: string;
}

const ROOT_LABEL: Record<NavGroup, string> = {
  workspace: "Workspace",
  library: "Library",
  system: "System",
};

/** Landing page for each nav family — makes the group crumb clickable. */
const ROOT_HREF: Record<NavGroup, string> = {
  workspace: "/",
  library: "/notes",
  system: "/status",
};

function buildCrumbs(pathname: string): Crumb[] {
  const item = ALL_NAV_DESTINATIONS.find((n) =>
    n.href === "/" ? pathname === "/" : pathname.startsWith(n.href),
  );
  if (!item) return [{ label: "Workspace" }, { label: pathname }];
  const groupLabel = ROOT_LABEL[item.group] ?? "Workspace";
  const rootHref = ROOT_HREF[item.group];
  return [
    { label: groupLabel, href: item.href === rootHref ? undefined : rootHref },
    { label: item.label },
  ];
}

/**
 * Desktop chrome — breadcrumbs, pending-changes indicator, focus timer,
 * quick-add panel buttons, ⌘K search, and theme picker. Panels: ⌘⇧O
 * (notes), ⌘⇧T (tasks), ⌘⇧D (diagrams).
 */
export function HubTopBar() {
  const pathname = usePathname();
  const crumbs = useMemo(() => buildCrumbs(pathname), [pathname]);
  const isOnChamber = pathname === "/chamber";
  const isOnOpenCode = pathname === "/opencode";
  const launchChamberDesktop = useLaunchChamberDesktop();
  const launchOpenCodeDesktop = useLaunchOpenCodeDesktop();

  function openPalette() {
    window.dispatchEvent(new CustomEvent("devhub:palette-toggle"));
  }

  return (
    // Visibility (desktop-only) is owned by `.hub-topbar` in globals.css —
    // a Tailwind `hidden md:flex` here would be silently overridden.
    <header className="hub-topbar">
      <nav aria-label="Breadcrumbs" className="hub-crumbs">
        {crumbs.map((c, i) => (
          <span key={i} className="hub-crumb">
            {c.href ? <Link href={c.href}>{c.label}</Link> : <span>{c.label}</span>}
            {i < crumbs.length - 1 && <span aria-hidden className="hub-crumb-sep">›</span>}
          </span>
        ))}
      </nav>
      <SectionTabs />
      {/* Visible search box — opens the ⌘K palette. */}
      <button
        type="button"
        className="hub-search"
        onClick={openPalette}
        aria-label="Search everything (⌘K)"
      >
        <Search size={13} aria-hidden />
        <span className="hub-search-label">Search…</span>
        <kbd className="hub-search-kbd" aria-hidden>⌘K</kbd>
      </button>
      <div className="hub-topbar-actions">
        {/* Signal cluster — git sync + dirty indicators */}
        <ContentSyncIndicator />

        {/* Focus cluster — timer */}
        <span role="group" className="flex items-center gap-0.5" aria-label="Focus">
          <FocusTimer />
        </span>

        {/* Quick cluster — notes/tasks/diagrams/theme/accent/chamber */}
        <span role="group" className="flex items-center gap-0.5 px-1 rounded" style={CLUSTER_STYLE} aria-label="Quick actions">
          <NotesBrowseButton />
          <TasksBrowseButton />
          <DiagramsBrowseButton />
          <TerminalDockButton />
          <ThemeToggle />
          {isOnChamber && (
            <button
              type="button"
              onClick={() => void launchChamberDesktop()}
              className="hub-icon-btn"
              data-tooltip="Open in OpenChamber Desktop"
              data-tooltip-pos="bottom-end"
              aria-label="Open in OpenChamber Desktop"
            >
              <Monitor size={14} aria-hidden />
            </button>
          )}
          {isOnOpenCode && (
            <button
              type="button"
              onClick={() => void launchOpenCodeDesktop()}
              className="hub-icon-btn"
              data-tooltip="Open in OpenCode Desktop"
              data-tooltip-pos="bottom-end"
              aria-label="Open in OpenCode Desktop"
            >
              <Terminal size={14} aria-hidden />
            </button>
          )}
          <AccentPicker />
          <Link
            href="/setup"
            className="hub-icon-btn"
            data-tooltip="Setup & integrations"
            data-tooltip-pos="bottom-end"
            aria-label="Setup and integrations"
          >
            <Settings size={14} aria-hidden />
          </Link>
        </span>
      </div>
    </header>
  );
}
