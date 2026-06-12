"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Plus, RotateCw, TerminalSquare, X } from "lucide-react";
import "@xterm/xterm/css/xterm.css";

const TERMINAL_PORT = process.env.NEXT_PUBLIC_TERMINAL_PORT ?? "1339";

/** Nerd Font chain — p10k glyphs render instead of tofu. All local fonts. */
const TERMINAL_FONT =
  '"JetBrainsMono Nerd Font", "MesloLGM Nerd Font", "MesloLGS NF", "Hack Nerd Font", "FiraCode Nerd Font", ui-monospace, Menlo, monospace';

type Status = "connecting" | "open" | "closed";

/** Read a CSS custom property off :root, with a fallback. */
function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

interface SessionProps {
  /** Start directory; server falls back to the developer dir. */
  cwd?: string;
  /** Sessions stay mounted when inactive; refit + focus when activated. */
  active: boolean;
  onStatus?: (status: Status) => void;
}

/**
 * One persistent shell session. The xterm instance and WebSocket live for
 * the lifetime of the component — hiding the dock or switching tabs only
 * hides the DOM, so long-running commands keep running.
 */
export function TerminalSession({ cwd, active, onStatus }: SessionProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<{ fit: () => void } | null>(null);
  const termRef = useRef<{ focus: () => void } | null>(null);
  const onStatusRef = useRef(onStatus);
  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed) return;

      const term = new Terminal({
        cursorBlink: true,
        fontFamily: TERMINAL_FONT,
        fontSize: 13,
        lineHeight: 1.2,
        scrollback: 8_000,
        theme: {
          background: cssVar("--bg-surface", "#11161b"),
          foreground: cssVar("--text", "#e6edf3"),
          cursor: cssVar("--accent", "#9ed84a"),
          selectionBackground: cssVar("--accent-dim", "rgba(158,216,74,0.25)"),
        },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host);
      fit.fit();
      fitRef.current = fit;
      termRef.current = term;

      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const params = new URLSearchParams({ shell: "login" });
      if (cwd) params.set("cwd", cwd);
      const socket = new WebSocket(
        `${proto}://${window.location.hostname}:${TERMINAL_PORT}/?${params}`,
      );

      const sendResize = () => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      };

      socket.onopen = () => {
        if (disposed) return;
        onStatusRef.current?.("open");
        fit.fit();
        sendResize();
        term.focus();
      };
      socket.onmessage = (event) => {
        // Control frames (session/fallback/exited) are dock-internal noise —
        // swallow them; everything else is bytes for the terminal.
        if (typeof event.data === "string" && event.data.startsWith('{"devhubCtl"')) return;
        term.write(event.data as string);
      };
      socket.onclose = () => !disposed && onStatusRef.current?.("closed");
      socket.onerror = () => !disposed && onStatusRef.current?.("closed");

      const dataSub = term.onData((data) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(data);
      });

      const onResize = () => {
        fit.fit();
        sendResize();
      };
      window.addEventListener("resize", onResize);
      const observer = new ResizeObserver(onResize);
      observer.observe(host);

      cleanup = () => {
        window.removeEventListener("resize", onResize);
        observer.disconnect();
        dataSub.dispose();
        socket.close();
        term.dispose();
      };
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
    // Session identity is fixed at mount — a new cwd means a new session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fit and focus when this session becomes visible again.
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => {
      fitRef.current?.fit();
      termRef.current?.focus();
    }, 30);
    return () => clearTimeout(t);
  }, [active]);

  return <div ref={hostRef} className="terminal-host" style={{ height: "100%" }} />;
}

interface DockTab {
  id: number;
  cwd?: string;
  label: string;
  status: Status;
  /** Bump to tear the session down and rebuild (restart button). */
  generation: number;
}

interface OpenDetail {
  cwd?: string;
  label?: string;
}

/**
 * Global terminal drawer — toggled from anywhere (⌃` or the top-bar button),
 * any number of tabs, sessions persist across route changes and while the
 * dock is hidden. Repos rows open tabs cwd'd at the repo via
 * `devhub:terminal-open`.
 */
export function TerminalDock() {
  const [open, setOpen] = useState(false);
  const [tabs, setTabs] = useState<DockTab[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const idRef = useRef(0);

  const addTab = useCallback((detail?: OpenDetail) => {
    const id = ++idRef.current;
    const label = detail?.label ?? (detail?.cwd ? detail.cwd.split("/").pop() ?? "zsh" : "zsh");
    setTabs((prev) => [
      ...prev,
      { id, cwd: detail?.cwd, label, status: "connecting", generation: 0 },
    ]);
    setActiveId(id);
    setOpen(true);
  }, []);

  const closeTab = useCallback((id: number) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      setActiveId((curr) => (curr === id ? (next[next.length - 1]?.id ?? null) : curr));
      return next;
    });
  }, []);

  const toggle = useCallback(() => {
    setOpen((wasOpen) => {
      if (!wasOpen) {
        setTabs((prev) => {
          if (prev.length === 0) {
            const id = ++idRef.current;
            setActiveId(id);
            return [{ id, label: "zsh", status: "connecting" as Status, generation: 0 }];
          }
          return prev;
        });
      }
      return !wasOpen;
    });
  }, []);

  useEffect(() => {
    const onToggle = () => toggle();
    const onOpen = (e: Event) => addTab((e as CustomEvent<OpenDetail>).detail);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "`" && e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("devhub:terminal-toggle", onToggle);
    window.addEventListener("devhub:terminal-open", onOpen);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("devhub:terminal-toggle", onToggle);
      window.removeEventListener("devhub:terminal-open", onOpen);
      document.removeEventListener("keydown", onKey);
    };
  }, [toggle, addTab]);

  const setStatus = useCallback((id: number, status: Status) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));
  }, []);

  const restartTab = useCallback((id: number) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, generation: t.generation + 1, status: "connecting" } : t,
      ),
    );
  }, []);

  if (tabs.length === 0) return null;
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  return (
    <div className="terminal-dock" style={{ display: open ? undefined : "none" }} role="complementary" aria-label="Terminal">
      <div className="terminal-dock-bar">
        <div className="terminal-dock-tabs" role="tablist" aria-label="Terminal tabs">
          {tabs.map((tab) => (
            <span
              key={tab.id}
              role="tab"
              aria-selected={tab.id === active?.id}
              className="terminal-dock-tab"
              data-active={tab.id === active?.id || undefined}
              onClick={() => setActiveId(tab.id)}
            >
              <span className="terminal-dot" data-status={tab.status} aria-hidden />
              <span className="terminal-dock-tab-label">{tab.label}</span>
              <button
                type="button"
                className="terminal-dock-tab-close"
                aria-label={`Close ${tab.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
              >
                <X size={10} aria-hidden />
              </button>
            </span>
          ))}
          <button
            type="button"
            className="hub-icon-btn"
            onClick={() => addTab()}
            aria-label="New terminal"
            data-tooltip="New terminal"
            data-tooltip-pos="top"
          >
            <Plus size={13} aria-hidden />
          </button>
        </div>
        <div className="terminal-dock-actions">
          {active?.cwd && (
            <span className="terminal-dock-cwd">{active.cwd.replace(/^\/Users\/[^/]+/, "~")}</span>
          )}
          {active && (
            <button
              type="button"
              className="hub-icon-btn"
              onClick={() => restartTab(active.id)}
              aria-label="Restart session"
              data-tooltip="Restart session"
              data-tooltip-pos="top"
            >
              <RotateCw size={12} aria-hidden />
            </button>
          )}
          <button
            type="button"
            className="hub-icon-btn"
            onClick={() => setOpen(false)}
            aria-label="Hide terminal (sessions keep running)"
            data-tooltip="Hide (⌃`)"
            data-tooltip-pos="top"
          >
            <ChevronDown size={14} aria-hidden />
          </button>
        </div>
      </div>
      <div className="terminal-dock-body">
        {tabs.map((tab) => (
          <div
            key={`${tab.id}-${tab.generation}`}
            style={{ display: tab.id === active?.id ? "block" : "none", height: "100%" }}
          >
            <TerminalSession
              cwd={tab.cwd}
              active={open && tab.id === active?.id}
              onStatus={(s) => setStatus(tab.id, s)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Top-bar toggle — lives in the quick cluster. */
export function TerminalDockButton() {
  return (
    <button
      type="button"
      className="hub-icon-btn"
      onClick={() => window.dispatchEvent(new CustomEvent("devhub:terminal-toggle"))}
      data-tooltip="Terminal (⌃`)"
      data-tooltip-pos="bottom-end"
      aria-label="Toggle terminal"
    >
      <TerminalSquare size={14} aria-hidden />
    </button>
  );
}
