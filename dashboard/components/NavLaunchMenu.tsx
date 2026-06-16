"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { Bot, Monitor, Play, TerminalSquare } from "lucide-react";
import { useLaunchChamberDesktop } from "@/lib/launch-chamber";
import { useLaunchOpenCodeDesktop } from "@/lib/launch-opencode";
import { useLaunchClaudeDesktop } from "@/lib/launch-claude";
import { claudeCliCommand, opencodeCliCommand, openTerminal } from "@/lib/terminal-launch";

type LaunchIcon = "chamber" | "opencode" | "claude";

interface LaunchEntry {
  /**
   * CLI to run in the terminal drawer, or null for tools without a usable
   * interactive CLI (OpenChamber's `openchamber` command only boots the web
   * server DevHub already runs). Null → single "launch desktop app" button.
   */
  cli: { label: string; command: () => string } | null;
  appDescription: string;
}

const ENTRIES: Record<LaunchIcon, LaunchEntry> = {
  chamber: {
    cli: null,
    appDescription: "Launch the native OpenChamber desktop app.",
  },
  opencode: {
    cli: { label: "OpenCode", command: opencodeCliCommand },
    appDescription: "Launch the native OpenCode desktop app.",
  },
  claude: {
    cli: { label: "Claude", command: claudeCliCommand },
    appDescription: "Launch the native Claude desktop app.",
  },
};

const TRIGGER_STYLE: CSSProperties = {
  position: "absolute",
  right: 6,
  top: "50%",
  transform: "translateY(-50%)",
  width: 20,
  height: 20,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 4,
  border: "none",
  cursor: "pointer",
  padding: 0,
  zIndex: 1,
};

/**
 * Launcher for the System sidebar rows. The visible trigger is the same small
 * play glyph as before. Tools with a real interactive CLI (OpenCode, Claude)
 * open a portal menu offering the terminal drawer or the native desktop app —
 * mirroring the launch menu on the Repos screen. OpenChamber, whose CLI only
 * starts a server, keeps a single button that launches its desktop app.
 */
export function NavLaunchMenu({ icon, label }: { icon: LaunchIcon; label: string }) {
  const launchChamber = useLaunchChamberDesktop();
  const launchOpenCode = useLaunchOpenCodeDesktop();
  const launchClaude = useLaunchClaudeDesktop();

  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | undefined>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const entry = ENTRIES[icon];
  const launchApp =
    icon === "chamber" ? launchChamber : icon === "opencode" ? launchOpenCode : launchClaude;

  function updateMenuPosition() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuStyle({ top: rect.bottom + 6, left: Math.max(8, rect.left) });
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open]);

  const setHover = (e: ReactMouseEvent<HTMLButtonElement>, active: boolean) => {
    if (active || open) {
      e.currentTarget.style.background = "var(--accent-dim)";
      e.currentTarget.style.color = "var(--text)";
    } else {
      e.currentTarget.style.background = "transparent";
      e.currentTarget.style.color = "var(--text-subtle)";
    }
  };

  // No usable CLI (OpenChamber) → single click launches the desktop app.
  if (!entry.cli) {
    return (
      <button
        ref={triggerRef}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void launchApp();
        }}
        title={`Launch ${label} Desktop`}
        aria-label={`Launch ${label} Desktop`}
        style={{ ...TRIGGER_STYLE, background: "transparent", color: "var(--text-subtle)" }}
        onMouseEnter={(e) => setHover(e, true)}
        onMouseLeave={(e) => setHover(e, false)}
      >
        <Play size={11} strokeWidth={2} fill="currentColor" />
      </button>
    );
  }

  const cli = entry.cli;

  return (
    <>
      <button
        ref={triggerRef}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          updateMenuPosition();
          setOpen((value) => !value);
        }}
        title={`Launch ${label}`}
        aria-label={`Launch ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          ...TRIGGER_STYLE,
          background: open ? "var(--accent-dim)" : "transparent",
          color: open ? "var(--text)" : "var(--text-subtle)",
        }}
        onMouseEnter={(e) => setHover(e, true)}
        onMouseLeave={(e) => setHover(e, false)}
      >
        <Play size={11} strokeWidth={2} fill="currentColor" />
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div ref={menuRef} className="launch-menu" role="menu" style={menuStyle}>
            <button
              type="button"
              className="launch-menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                openTerminal({ label: cli.label, command: cli.command() });
              }}
            >
              <span className="launch-menu-icon">
                <TerminalSquare size={13} />
              </span>
              <span className="launch-menu-copy">
                <span className="launch-menu-label">Terminal</span>
                <span className="launch-menu-description">
                  Open {label} in the terminal drawer.
                </span>
              </span>
            </button>
            <button
              type="button"
              className="launch-menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void launchApp();
              }}
            >
              <span className="launch-menu-icon">
                {icon === "claude" ? <Bot size={13} /> : <Monitor size={13} />}
              </span>
              <span className="launch-menu-copy">
                <span className="launch-menu-label">Desktop app</span>
                <span className="launch-menu-description">{entry.appDescription}</span>
              </span>
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
