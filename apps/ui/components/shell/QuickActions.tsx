"use client";

import Link, { usePathname, useSearchParams } from "@/lib/navigation";
import { Bot } from "lucide-react";
import { NotesBrowseButton } from "@/components/notes/NotesBrowseButton";
import { TasksBrowseButton } from "@/components/tasks/TasksBrowseButton";
import { DiagramsBrowseButton } from "@/components/diagrams/DiagramsBrowseButton";
import { TerminalDockButton } from "@/components/shell/TerminalDock";
import { TopBarMoreMenu } from "@/components/shell/TopBarMoreMenu";
import { HoverTip } from "@/components/ui/HoverTip";
import { useLive } from "@/lib/hooks/use-fetch";

/**
 * Notes, tasks and diagrams are one family: side panels. They sit inline when
 * the bar has room and fold into a Panels button when it does not. Terminal
 * stays visible either way — its badge is status. The container query in
 * globals.css (`.hub-panel-actions` / `.hub-panels-menu`) shows exactly one of
 * the inline row or the menu.
 */
export function QuickActions() {
  const pathname = usePathname();
  const params = useSearchParams();
  const { data: connection, error } = useLive<{ connected: boolean; error?: string }>(
    "/api/agent/connection",
    {
      // TODO(event): managed-service actions need to emit; Paseo can also disconnect independently.
      refreshInterval: (data) => data?.connected ? 60_000 : 10_000,
    },
  );
  const active = pathname === "/agents" && params.get("view") !== "connection" && params.get("view") !== "usage";
  const available = connection?.connected === true && !error;
  const label = available ? "Chat" : `Chat: ${connection?.error ?? (error ? "Could not check the Paseo connection" : "Checking Paseo connection…")}`;

  return (
    <>
      <span className="hub-panel-actions">
        <NotesBrowseButton />
        <TasksBrowseButton />
        <DiagramsBrowseButton />
      </span>
      <TopBarMoreMenu />
      <TerminalDockButton />
      <HoverTip label={label} pos="bottom-end">
        {available ? (
          <Link href="/agents" className="hub-icon-btn" data-active={active || undefined} aria-current={active ? "page" : undefined} aria-label={label}>
            <Bot size={14} aria-hidden />
          </Link>
        ) : (
          <button type="button" className="hub-icon-btn opacity-50" data-active={active || undefined} aria-label={label} aria-disabled="true">
            <Bot size={14} aria-hidden />
          </button>
        )}
      </HoverTip>
    </>
  );
}
