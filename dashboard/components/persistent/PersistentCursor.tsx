"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { TerminalSession } from "@/components/shell/TerminalDock";
import { cursorCliCommand } from "@/lib/terminal-launch";

/**
 * Keeps a Cursor agent CLI terminal session alive across client-side route
 * changes. Lazy-mounts on first visit to /cursor and persists with
 * display:none elsewhere, so the conversation isn't lost when the user
 * navigates away.
 *
 * Unlike OpenChamber/OpenCode (embedded web services in an iframe), Cursor
 * is a CLI — so the dedicated page hosts an embedded terminal running
 * `cursor-agent` rather than an iframe.
 */
export function PersistentCursor() {
  const pathname = usePathname();
  const isActive = pathname === "/cursor";
  const [mounted, setMounted] = useState(false);

  if (!mounted && isActive) setMounted(true);

  // RAM guard: keep the session mounted across routes to preserve history,
  // but release it after a long idle so an abandoned session stops eating
  // memory. It remounts fresh (a new `cursor-agent` session) on the next visit.
  useEffect(() => {
    if (isActive || !mounted) return;
    const IDLE_UNLOAD_MS = 20 * 60 * 1000; // 20 minutes away → release it
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
      <TerminalSession active={isActive} command={cursorCliCommand()} />
    </div>
  );
}
