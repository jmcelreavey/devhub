"use client";

import Link from "next/link";
import { Search, Settings } from "lucide-react";
import { ContentSyncIndicator } from "@/components/runs/ContentSyncIndicator";
import { AccentPicker } from "@/components/shell/AccentPicker";
import { ProfileSwitcher } from "@/components/shell/ProfileSwitcher";
import { QuickActions } from "@/components/shell/QuickActions";
import { SectionTabs } from "@/components/shell/SectionTabs";
import { FocusTimer } from "@/components/tasks/FocusTimer";
import { HoverTip } from "@/components/ui/HoverTip";
import { useClientMounted } from "@/lib/hooks/use-client-mounted";
import { useModifierKey } from "@/lib/hooks/use-modifier-key";

/**
 * Four beats, left to right: where you are (section), find (search), do
 * (focus, then the panel toggles), and preferences. Notes, tasks and diagrams
 * are panels. Setup is configuration, so it sits with appearance and profile.
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
        <div className="hub-toolbar-group">
          <FocusTimer />
          <div role="group" className="hub-panels" aria-label="Panels">
            <QuickActions />
          </div>
        </div>
        <div role="group" className="hub-toolbar-group hub-preferences" aria-label="Preferences">
          <AccentPicker />
          <SetupHeaderButton />
          <ProfileSwitcher />
        </div>
      </div>
    </header>
  );
}

function SetupHeaderButton() {
  return (
    <HoverTip label="Setup and integrations" pos="bottom-end">
      <Link href="/setup" className="hub-icon-btn" aria-label="Setup and integrations">
        <Settings size={14} aria-hidden />
      </Link>
    </HoverTip>
  );
}
