"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { TerminalSession } from "./TerminalDock";
import { claudeCliCommand } from "@/lib/terminal-launch";

/**
 * Keeps a Claude CLI terminal session alive across client-side route changes.
 * Lazy-mounts on first visit to /claude and persists with display:none
 * elsewhere, so the conversation isn't lost when the user navigates away.
 *
 * Unlike OpenChamber/OpenCode (embedded web services in an iframe), Claude
 * is a CLI — so the dedicated page hosts an embedded terminal running
 * `claude` rather than an iframe.
 */
export function PersistentClaude() {
  const pathname = usePathname();
  const isActive = pathname === "/claude";
  const [mounted, setMounted] = useState(false);

  if (!mounted && isActive) setMounted(true);

  // RAM guard: keep the session mounted across routes to preserve history,
  // but release it after a long idle so an abandoned session stops eating
  // memory. It remounts fresh (a new `claude` session) on the next visit.
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
        zIndex: 1,
      }}
    >
      <TerminalSession active={isActive} command={claudeCliCommand()} />
    </div>
  );
}
