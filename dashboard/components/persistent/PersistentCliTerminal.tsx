"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { TerminalSession } from "@/components/shell/TerminalSession";
import { chatgptCliCommand, claudeCliCommand, cursorCliCommand } from "@/lib/terminal-launch";

/** Keep an abandoned session's PTY from eating memory forever. */
const IDLE_UNLOAD_MS = 20 * 60 * 1000;

/**
 * Hosts a CLI companion (Claude, Cursor, ChatGPT/Codex) as an embedded
 * terminal, kept alive across client-side route changes so the conversation
 * survives navigating away. Unlike OpenChamber/OpenCode there is no web server
 * to iframe — these are just command-line tools.
 *
 * Lazy-mounts on first visit to `route`, persists with display:none elsewhere,
 * then releases after a long idle and remounts fresh on the next visit.
 */
function PersistentCliTerminal({ route, command }: { route: string; command: string }) {
  const isActive = usePathname() === route;
  const [mounted, setMounted] = useState(false);

  if (!mounted && isActive) setMounted(true);

  useEffect(() => {
    if (isActive || !mounted) return;
    const t = setTimeout(() => setMounted(false), IDLE_UNLOAD_MS);
    return () => clearTimeout(t);
  }, [isActive, mounted]);

  if (!mounted) return null;

  return (
    <div
      aria-hidden={!isActive}
      style={{
        position: "absolute",
        inset: 0,
        display: isActive ? "block" : "none",
        background: "var(--bg-surface)",
        zIndex: "var(--z-base)",
      }}
    >
      <TerminalSession active={isActive} command={command} />
    </div>
  );
}

/** The CLI companions that get their own sidebar tab. */
const CLI_TABS = [
  { route: "/claude", command: claudeCliCommand },
  { route: "/cursor", command: cursorCliCommand },
  { route: "/chatgpt", command: chatgptCliCommand },
];

/** All CLI companion terminals, mounted once in the root layout. */
export function PersistentCliTerminals() {
  return (
    <>
      {CLI_TABS.map(({ route, command }) => (
        <PersistentCliTerminal key={route} route={route} command={command()} />
      ))}
    </>
  );
}
