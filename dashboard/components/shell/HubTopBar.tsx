"use client";

import { ContentSyncIndicator } from "@/components/runs/ContentSyncIndicator";
import { AccentPicker } from "@/components/shell/AccentPicker";
import { QuickActions } from "@/components/shell/QuickActions";
import { SectionTabs } from "@/components/shell/SectionTabs";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { useWorkspaceTabs } from "@/components/shell/WorkspaceTabs";
import { uniqueSessionHistory } from "@/lib/session-history";
import { FocusTimer } from "@/components/tasks/FocusTimer";
import { HoverTip } from "@/components/ui/HoverTip";
import { Search,Settings } from "lucide-react";
import Link from "next/link";
import { usePathname,useSearchParams } from "next/navigation";

/**
 * Desktop chrome — breadcrumbs, pending-changes indicator, focus timer,
 * quick-add panel buttons, ⌘P search, and theme picker. Panels: ⌘N
 * (notes), ⌘T (tasks), ⌘D (diagrams). Terminal: ⌃`.
 */
export function HubTopBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const currentHref = query ? `${pathname}?${query}` : pathname;
  const trail = uniqueSessionHistory(useWorkspaceTabs().history, 5);
  function openPalette() {
    window.dispatchEvent(new CustomEvent("devhub:palette-toggle"));
  }

  return (
    // Visibility (desktop-only) is owned by `.hub-topbar` in globals.css —
    // a Tailwind `hidden md:flex` here would be silently overridden.
    <header className="hub-topbar">
      <nav aria-label="Navigation history" className="hub-crumbs">
        {trail.map((entry, i) => (
          <span key={`${entry.href}:${entry.ts}`} className="hub-crumb">
            {entry.href === currentHref ? <span>{entry.label}</span> : <Link href={entry.href}>{entry.label}</Link>}
            {i < trail.length - 1 && <span aria-hidden className="hub-crumb-sep">›</span>}
          </span>
        ))}
      </nav>
      <SectionTabs />
      {/* Visible search box - opens the ⌘P palette. */}
      <button
        type="button"
        className="hub-search"
        onClick={openPalette}
        aria-label="Search everything (⌘P)"
      >
        <Search size={13} aria-hidden />
        <span className="hub-search-label">Search…</span>
        <kbd className="hub-search-kbd" aria-hidden>⌘P</kbd>
      </button>
      <div className="hub-topbar-actions">
        {/* Signal cluster - git sync + dirty indicators */}
        <ContentSyncIndicator />

        {/* Focus cluster - timer */}
        <span role="group" className="flex items-center gap-0.5" aria-label="Focus">
          <FocusTimer />
        </span>

        {/* Quick cluster - notes/tasks/diagrams/theme/accent */}
        <span role="group" className="hub-cluster" aria-label="Quick actions">
          <QuickActions />
          <ThemeToggle />
          <AccentPicker />
          <HoverTip label="Setup & integrations" pos="bottom-end">
            <Link
              href="/setup"
              className="hub-icon-btn"
              aria-label="Setup and integrations"
            >
              <Settings size={14} aria-hidden />
            </Link>
          </HoverTip>
        </span>
      </div>
    </header>
  );
}
