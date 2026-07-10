"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ClipboardCopy, Plus, RotateCw, TerminalSquare, X } from "lucide-react";
import "@xterm/xterm/css/xterm.css";

const TERMINAL_PORT = process.env.NEXT_PUBLIC_TERMINAL_PORT ?? "1339";

/**
 * Scrollback lines retained per session. The PTY server streams everything
 * live and keeps no backlog of its own, so this is the only cap on how far
 * you can scroll up — the old 8k default filled in ~10 min of chatty output.
 * ~50k lines is a few hours of history at a modest memory cost; override with
 * NEXT_PUBLIC_TERMINAL_SCROLLBACK.
 */
const TERMINAL_SCROLLBACK = Number.parseInt(
  process.env.NEXT_PUBLIC_TERMINAL_SCROLLBACK ?? "50000",
  10,
);

/** Nerd Font chain — p10k glyphs render instead of tofu. All local fonts. */
const TERMINAL_FONT =
  '"JetBrainsMono Nerd Font", "MesloLGM Nerd Font", "MesloLGS NF", "Hack Nerd Font", "FiraCode Nerd Font", ui-monospace, Menlo, monospace';

type Status = "connecting" | "open" | "closed";

/**
 * Lets the dock read a session's output for "copy all". `sessionId` (once the
 * server has assigned one) points at the complete on-disk log; `getBuffer` is
 * the RAM-capped xterm scrollback used as a fallback.
 */
export interface TerminalReader {
  getBuffer: () => string;
  sessionId: () => string | null;
}

/** Read a CSS custom property off :root, with a fallback. */
function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

interface SessionProps {
  /** Start directory; server falls back to the developer dir. */
  cwd?: string;
  /** Optional command to run once after the shell opens. */
  command?: string;
  /** Sessions stay mounted when inactive; refit + focus when activated. */
  active: boolean;
  onStatus?: (status: Status) => void;
  /**
   * Register a reader for this session's output (called with the reader on
   * open, and with null on teardown). Lets the dock offer a "copy all" action
   * for whichever session is active.
   */
  onReader?: (reader: TerminalReader | null) => void;
}

/**
 * One persistent shell session. The xterm instance and WebSocket live for
 * the lifetime of the component — hiding the dock or switching tabs only
 * hides the DOM, so long-running commands keep running.
 */
export function TerminalSession({ cwd, command, active, onStatus, onReader }: SessionProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<{ fit: () => void } | null>(null);
  const termRef = useRef<{ focus: () => void } | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const onStatusRef = useRef(onStatus);
  const onReaderRef = useRef(onReader);
  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);
  useEffect(() => {
    onReaderRef.current = onReader;
  }, [onReader]);

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
        scrollback: TERMINAL_SCROLLBACK,
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

      // Serialize the whole scrollback (+ viewport) as plain text so the dock
      // can copy it. translateToString(true) trims trailing whitespace per row.
      const getText = () => {
        const buffer = term.buffer.active;
        const rows: string[] = [];
        for (let i = 0; i < buffer.length; i++) {
          rows.push(buffer.getLine(i)?.translateToString(true) ?? "");
        }
        return rows.join("\n").replace(/\n+$/, "") + "\n";
      };
      onReaderRef.current?.({ getBuffer: getText, sessionId: () => sessionIdRef.current });

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
        if (command?.trim()) {
          socket.send("stty -echo\r");
          window.setTimeout(() => {
            if (socket.readyState !== WebSocket.OPEN) return;
            socket.send(`clear\r${command.trim()}; stty echo\r`);
          }, 50);
        }
        term.focus();
      };
      socket.onmessage = (event) => {
        // Control frames (session/fallback/exited) are dock-internal noise —
        // swallow them; everything else is bytes for the terminal. The session
        // frame carries the id used to fetch the full on-disk log for copy-all.
        if (typeof event.data === "string" && event.data.startsWith('{"devhubCtl"')) {
          try {
            const ctl = JSON.parse(event.data) as { type?: string; sessionId?: string };
            if (ctl.type === "session" && typeof ctl.sessionId === "string") {
              sessionIdRef.current = ctl.sessionId;
            }
          } catch {
            /* ignore malformed control frame */
          }
          return;
        }
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
        onReaderRef.current?.(null);
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
  command?: string;
  label: string;
  status: Status;
  /** Bump to tear the session down and rebuild (restart button). */
  generation: number;
}

interface OpenDetail {
  cwd?: string;
  label?: string;
  command?: string;
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
  /** Per-session output readers, keyed by tab id. */
  const readersRef = useRef(new Map<number, TerminalReader>());
  const [copied, setCopied] = useState(false);
  /**
   * Restart is a two-step action: first click arms, second click confirms.
   * We track the armed tab by id (not a boolean) so switching tabs implicitly
   * disarms it — no effect needed.
   */
  const [armedRestartId, setArmedRestartId] = useState<number | null>(null);
  const restartTimerRef = useRef<number | undefined>(undefined);

  const addTab = useCallback((detail?: OpenDetail) => {
    const id = ++idRef.current;
    const label = detail?.label ?? (detail?.cwd ? detail.cwd.split("/").pop() ?? "zsh" : "zsh");
    setTabs((prev) => [
      ...prev,
      { id, cwd: detail?.cwd, command: detail?.command, label, status: "connecting", generation: 0 },
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

  const copyActive = useCallback(async () => {
    if (activeId == null) return;
    const reader = readersRef.current.get(activeId);
    // Prefer the complete on-disk log (unbounded by scrollback); fall back to
    // the in-memory buffer if the server log isn't reachable.
    let text = "";
    const sid = reader?.sessionId() ?? null;
    if (sid) {
      try {
        const res = await fetch(`/api/terminal/log?session=${encodeURIComponent(sid)}`);
        if (res.ok) text = await res.text();
      } catch {
        /* fall back to the buffer below */
      }
    }
    if (!text) text = reader?.getBuffer() ?? "";
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API unavailable (e.g. non-secure context) — fall back to a
      // hidden textarea + execCommand so copy still works over plain http.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* nothing more we can do */
      }
      ta.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, [activeId]);

  const handleRestart = useCallback(
    (id: number) => {
      if (armedRestartId === id) {
        window.clearTimeout(restartTimerRef.current);
        setArmedRestartId(null);
        restartTab(id);
      } else {
        setArmedRestartId(id);
        restartTimerRef.current = window.setTimeout(() => setArmedRestartId(null), 3000);
      }
    },
    [armedRestartId, restartTab],
  );

  useEffect(() => () => window.clearTimeout(restartTimerRef.current), []);

  if (tabs.length === 0) return null;
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const restartArmed = !!active && armedRestartId === active.id;

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
            className="hub-icon-btn terminal-dock-btn"
            onClick={() => addTab()}
            aria-label="New terminal"
            data-tooltip="New terminal"
            data-tooltip-pos="top"
          >
            <Plus size={13} aria-hidden />
            <span className="hub-btn-label">New</span>
          </button>
        </div>
        <div className="terminal-dock-actions">
          {active?.cwd && (
            <span className="terminal-dock-cwd">{active.cwd.replace(/^\/Users\/[^/]+/, "~")}</span>
          )}
          {active && (
            <button
              type="button"
              className="hub-icon-btn terminal-dock-btn"
              onClick={copyActive}
              aria-label={copied ? "Copied" : "Copy all terminal output"}
              data-tooltip={copied ? "Copied!" : "Copy all output"}
              data-tooltip-pos="top-end"
            >
              {copied ? <Check size={12} aria-hidden /> : <ClipboardCopy size={12} aria-hidden />}
              <span className="hub-btn-label">{copied ? "Copied" : "Copy"}</span>
            </button>
          )}
          {active && (
            <button
              type="button"
              className="hub-icon-btn terminal-dock-btn"
              data-armed={restartArmed || undefined}
              onClick={() => handleRestart(active.id)}
              aria-label={restartArmed ? "Click again to confirm restart" : "Restart session"}
              data-tooltip={restartArmed ? "Click again to confirm" : "Restart session"}
              data-tooltip-pos="top-end"
            >
              <RotateCw size={12} aria-hidden />
              <span className="hub-btn-label">{restartArmed ? "Confirm?" : "Restart"}</span>
            </button>
          )}
          <button
            type="button"
            className="hub-icon-btn terminal-dock-btn"
            onClick={() => setOpen(false)}
            aria-label="Hide terminal (sessions keep running)"
            data-tooltip="Hide (⌃`)"
            data-tooltip-pos="top-end"
          >
            <ChevronDown size={14} aria-hidden />
            <span className="hub-btn-label">Hide</span>
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
              command={tab.command}
              active={open && tab.id === active?.id}
              onStatus={(s) => setStatus(tab.id, s)}
              onReader={(reader) => {
                if (reader) readersRef.current.set(tab.id, reader);
                else readersRef.current.delete(tab.id);
              }}
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
