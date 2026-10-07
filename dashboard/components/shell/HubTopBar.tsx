"use client";

import { ContentSyncIndicator } from "@/components/runs/ContentSyncIndicator";
import { AccentPicker } from "@/components/shell/AccentPicker";
import { ProfileSwitcher } from "@/components/shell/ProfileSwitcher";
import { QuickActions } from "@/components/shell/QuickActions";
import { SectionTabs } from "@/components/shell/SectionTabs";
import { useWorkspaceTabs } from "@/components/shell/WorkspaceTabs";
import { crumbKey, uniqueSessionHistory } from "@/lib/session-history";
import { useClientMounted } from "@/lib/hooks/use-client-mounted";
import { useModifierKey } from "@/lib/hooks/use-modifier-key";
import { FocusTimer } from "@/components/tasks/FocusTimer";
import { HoverTip } from "@/components/ui/HoverTip";
import { Search, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Desktop chrome — recent pages, pending-changes indicator, focus timer,
 * quick-add panel buttons, ⌘P search, and theme picker. Panels: ⌘N
 * (notes), ⌘T (tasks), ⌘D (diagrams). Terminal: ⌃`.
 */
export function HubTopBar() {
  const modifier = useModifierKey();
  const pathname = usePathname();
  // Previous pages only, newest first. The current page is already named by
  // the workspace tab directly below, and a "›" trail read as a hierarchy —
  // "Docs › Logs" looked like Logs lived inside Docs.
  const { history } = useWorkspaceTabs();
  const mounted = useClientMounted();
  // Stored history can arrive before this Suspense boundary has hydrated.
  const recent = (mounted ? uniqueSessionHistory(history, 5) : [])
    .filter((entry) => crumbKey(entry.href) !== crumbKey(pathname))
    .reverse()
    .slice(0, 4);
  function openPalette() {
    window.dispatchEvent(new CustomEvent("devhub:palette-toggle"));
  }

  return (
    // Visibility (desktop-only) is owned by `.hub-topbar` in globals.css —
    // a Tailwind `hidden md:flex` here would be silently overridden.
    <header className="hub-topbar">
      <nav aria-label="Recent pages" className="hub-crumbs">
        {recent.length > 0 && <span className="hub-recent-label">Recent</span>}
        {/* Separator leads its entry so an entry that wraps out of view takes its dot with it. */}
        {recent.map((entry, i) => (
          <span key={`${entry.href}:${entry.ts}`} className="hub-crumb">
            {i > 0 && (
              <span aria-hidden className="hub-crumb-sep">
                ·
              </span>
            )}
            <Link href={entry.href}>{entry.label}</Link>
          </span>
        ))}
      </nav>
      <SectionTabs />
      {/* Visible search box - opens the ⌘P palette. */}
      <button
        type="button"
        className="hub-search"
        disabled={!mounted}
        onClick={openPalette}
        aria-label={`Search everything (${modifier}P)`}
      >
        <Search size={13} aria-hidden />
        <span className="hub-search-label">Search…</span>
        <kbd className="hub-search-kbd" aria-hidden>
          {modifier}P
        </kbd>
      </button>
      <div className="hub-topbar-actions">
        <ContentSyncIndicator />
        <div
          role="group"
          className="hub-toolbar-group"
          aria-label="Workspace tools"
        >
          <FocusTimer />
          <QuickActions />
        </div>
        <div
          role="group"
          className="hub-toolbar-group hub-preferences"
          aria-label="Preferences"
        >
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
          <ProfileSwitcher />
        </div>
      </div>
    </header>
  );
}
