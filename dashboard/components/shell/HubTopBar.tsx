"use client";

import { useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Bot, ExternalLink, Monitor, Search, Settings, Terminal } from "lucide-react";
import { useSessionHistory } from "@/lib/hooks/use-session-history";
import { SectionTabs } from "@/components/shell/SectionTabs";
import { AccentPicker } from "@/components/shell/AccentPicker";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { FocusTimer } from "@/components/tasks/FocusTimer";
import { HoverTip } from "@/components/ui/HoverTip";
import { QuickActions } from "@/components/shell/QuickActions";
import { ContentSyncIndicator } from "@/components/runs/ContentSyncIndicator";
import { LaunchMenu, type LaunchMenuItem } from "@/components/shell/LaunchMenu";
import { useLaunchClaudeDesktop } from "@/lib/launch/claude";
import { useLaunchChamberDesktop } from "@/lib/launch/chamber";
import { useLaunchOpenCodeDesktop } from "@/lib/launch/opencode";
import { claudeCliCommand, openTerminal, opencodeCliCommand } from "@/lib/terminal-launch";
import { openInBrowser } from "@/lib/desktop/bridge";

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
  const trail = useSessionHistory().slice(-5);
  const isOnChamber = pathname === "/chamber";
  const isOnOpenCode = pathname === "/opencode";
  const launchChamberDesktop = useLaunchChamberDesktop();
  const launchOpenCodeDesktop = useLaunchOpenCodeDesktop();
  const launchClaudeDesktop = useLaunchClaudeDesktop();

  function openPalette() {
    window.dispatchEvent(new CustomEvent("devhub:palette-toggle"));
  }

  const toolLaunchItems = useMemo<LaunchMenuItem[] | null>(() => {
    if (isOnChamber) {
      return [
        {
          id: "chamber-browser",
          label: "Browser view",
          description: "Open the embedded Chamber page in a new tab.",
          icon: <ExternalLink size={13} />,
          onSelect: () => void openInBrowser("/chamber"),
        },
        {
          id: "chamber-desktop",
          label: "OpenChamber Desktop",
          description: "Launch the native app when installed.",
          icon: <Monitor size={13} />,
          onSelect: launchChamberDesktop,
        },
        {
          id: "chamber-terminal",
          label: "Terminal",
          description: "Open a shell for Chamber commands.",
          icon: <Terminal size={13} />,
          onSelect: () => openTerminal({ label: "Chamber" }),
        },
      ];
    }
    if (isOnOpenCode) {
      return [
        {
          id: "opencode-browser",
          label: "Browser view",
          description: "Open the embedded OpenCode page in a new tab.",
          icon: <ExternalLink size={13} />,
          onSelect: () => void openInBrowser("/opencode"),
        },
        {
          id: "opencode-desktop",
          label: "OpenCode Desktop",
          description: "Launch the native OpenCode app.",
          icon: <Monitor size={13} />,
          onSelect: launchOpenCodeDesktop,
        },
        {
          id: "opencode-terminal",
          label: "OpenCode CLI",
          description: "Run opencode in the terminal drawer.",
          icon: <Terminal size={13} />,
          onSelect: () =>
            openTerminal({
              label: "OpenCode",
              command: opencodeCliCommand(),
            }),
        },
        {
          id: "claude-desktop",
          label: "Claude app",
          description: "Launch Claude desktop or fall back to Claude web.",
          icon: <Bot size={13} />,
          onSelect: launchClaudeDesktop,
        },
        {
          id: "claude-terminal",
          label: "Claude CLI",
          description: "Run claude in the terminal drawer.",
          icon: <Terminal size={13} />,
          onSelect: () =>
            openTerminal({
              label: "Claude",
              command: claudeCliCommand(),
            }),
        },
      ];
    }
    return null;
  }, [isOnChamber, isOnOpenCode, launchChamberDesktop, launchClaudeDesktop, launchOpenCodeDesktop]);

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

        {/* Quick cluster - notes/tasks/diagrams/theme/accent/chamber */}
        <span role="group" className="hub-cluster" aria-label="Quick actions">
          <QuickActions />
          <ThemeToggle />
          {toolLaunchItems && (
            <LaunchMenu
              label="Open"
              icon={isOnOpenCode ? <Terminal size={13} aria-hidden /> : <Monitor size={13} aria-hidden />}
              items={toolLaunchItems}
              buttonClassName="btn btn-ghost"
              buttonStyle={{ fontSize: 12, padding: "3px 8px" }}
            />
          )}
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
