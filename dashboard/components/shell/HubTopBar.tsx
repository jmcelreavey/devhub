"use client";

import { ContentSyncIndicator } from "@/components/runs/ContentSyncIndicator";
import { AccentPicker } from "@/components/shell/AccentPicker";
import { ProfileSwitcher } from "@/components/shell/ProfileSwitcher";
import { QuickActions } from "@/components/shell/QuickActions";
import { SectionTabs } from "@/components/shell/SectionTabs";
import { useClientMounted } from "@/lib/hooks/use-client-mounted";
import { useModifierKey } from "@/lib/hooks/use-modifier-key";
import { FocusTimer } from "@/components/tasks/FocusTimer";
import { HoverTip } from "@/components/ui/HoverTip";
import { Search } from "lucide-react";

/**
 * Section navigation first, then search and a stable set of workspace tools.
 * Recent pages remain in the command palette and workspace history.
 */
export function HubTopBar() {
  const modifier = useModifierKey();
  const mounted = useClientMounted();
  function openPalette() {
    window.dispatchEvent(new CustomEvent("devhub:palette-toggle"));
  }

  return (
    <header className="hub-topbar">
      <SectionTabs />
      <HoverTip label={`Search everything (${modifier}P)`} pos="bottom-end" className="hub-search-wrap">
        <button
          type="button"
          className="hub-search"
          disabled={!mounted}
          onClick={openPalette}
          aria-label={`Search everything (${modifier}P)`}
          aria-keyshortcuts={`${modifier === "⌘" ? "Meta" : "Control"}+P`}
        >
          <Search size={14} aria-hidden />
          <span className="hub-search-label">Search…</span>
          <kbd className="hub-search-kbd" aria-hidden>{modifier}P</kbd>
        </button>
      </HoverTip>
      <div className="hub-topbar-actions">
        <ContentSyncIndicator />
        <div role="group" className="hub-toolbar-group" aria-label="Workspace tools">
          <FocusTimer />
          <QuickActions />
        </div>
        <div role="group" className="hub-toolbar-group hub-preferences" aria-label="Preferences">
          <AccentPicker />
          <ProfileSwitcher />
        </div>
      </div>
    </header>
  );
}
