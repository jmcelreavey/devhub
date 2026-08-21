"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import {
  applyTypedInput,
  commandFromPromptLine,
  lastNonEmptyLine,
  parseOsc133,
  setTerminalSelectionDrag,
  shouldRecordTypedCommand,
  TERMINAL_SELECTION_MIME,
  TERMINAL_SELECTION_MIME_LEGACY,
} from "@/lib/terminal-blocks";
import { isTerminalBusy } from "@/lib/terminal-inject";
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

export const TERMINAL_FONT_SIZE_KEY = "devhub:terminal-font-size";
export const TERMINAL_FONT_SIZE_MIN = 9;
export const TERMINAL_FONT_SIZE_MAX = 24;
export const TERMINAL_FONT_SIZE_DEFAULT = 13;

export function readTerminalFontSize(): number {
  if (typeof window === "undefined") return TERMINAL_FONT_SIZE_DEFAULT;
  const raw = Number.parseInt(window.localStorage.getItem(TERMINAL_FONT_SIZE_KEY) ?? "", 10);
  if (!Number.isFinite(raw)) return TERMINAL_FONT_SIZE_DEFAULT;
  return Math.min(TERMINAL_FONT_SIZE_MAX, Math.max(TERMINAL_FONT_SIZE_MIN, raw));
}

export function writeTerminalFontSize(size: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TERMINAL_FONT_SIZE_KEY, String(size));
  } catch {
    /* private mode */
  }
}

export type Status = "connecting" | "open" | "closed";

/**
 * Lets the dock read a session's output for "copy all". `sessionId` (once the
 * server has assigned one) points at the complete on-disk log; `getBuffer` is
 * the RAM-capped xterm scrollback used as a fallback.
 */
export interface TerminalReader {
  getBuffer: () => string;
  /** Selected text in xterm, if any. */
  getSelection: () => string;
  /** Currently visible viewport (not full scrollback). */
  getViewport: () => string;
  sessionId: () => string | null;
  /** Ask the PTY peer to kill this shell (close tab / restart). */
  dispose: () => void;
  /** Inject stdin (confirmed commands only). */
  write: (data: string) => boolean;
  isBusy: () => boolean;
  /** Scroll the terminal so `line` (absolute buffer row) is in view. */
  scrollToLine: (line: number) => void;
  /** Absolute buffer row of the cursor — where the next output will land. */
  cursorLine: () => number;
  /** Open the in-pane find bar (⌘F). */
  openFind: () => void;
  /**
   * True once live shell integration (OSC 133) has been seen — the dock uses
   * this to stand down its heuristic block detection.
   */
  hasShellIntegration: () => boolean;
}

/** True while a full-screen app (vim, htop) owns the alternate buffer. */
export function isAltBuffer(term: { buffer: { active: { type: string } } }): boolean {
  return term.buffer.active.type === "alternate";
}

/** Keep the latest value of a prop in a ref. */
function useLatestRef<T>(value: T): { current: T } {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
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
  /** Reattach to an orphaned PTY after a UI remount (dashboard reload). */
  attachSessionId?: string | null;
  /** Sessions stay mounted when inactive; refit + focus when activated. */
  active: boolean;
  /**
   * When true (default), closing the WebSocket asks the PTY peer to kill the
   * shell. Dock tabs set this false so a remount can reattach.
   */
  killOnUnmount?: boolean;
  /** When false, skip term.focus on open/activate (MCP propose must not steal keys). */
  autoFocus?: boolean;
  /** Font size in px — dock owns zoom (⌘+/⌘−) and persistence. */
  fontSize?: number;
  onStatus?: (status: Status) => void;
  onSessionId?: (sessionId: string | null) => void;
  onBusy?: (busy: boolean) => void;
  onExitCode?: (code: number) => void;
  onReattached?: (reattached: boolean) => void;
  /** OSC 133 D — exact exit code from shell integration. */
  onCommandExit?: (code: number) => void;
  /** Alternate-buffer state changed (full-screen app started/stopped). */
  onAltBuffer?: (alt: boolean) => void;
  /** Register a reader for this session's output (called with the reader on
   * open, and with null on teardown). Lets the dock offer a "copy all" action
   * for whichever session is active.
   */
  onReader?: (reader: TerminalReader | null) => void;
  /** Cheap typed-in-xterm command detect (Enter on a prompt — not every key). */
  onCommandSubmit?: (command: string) => void;
  /**
   * Authoritative command-start from shell integration (OSC 133 C). When this
   * fires, heuristic detection stands down — the integration owns blocks.
   */
  onOscCommand?: (command: string) => void;
}

/**
 * One persistent shell session. The xterm instance and WebSocket live for
 * the lifetime of the component — hiding the dock or switching tabs only
 * hides the DOM, so long-running commands keep running.
 */
export function TerminalSession({
  cwd,
  command,
  attachSessionId,
  active,
  killOnUnmount = true,
  autoFocus = true,
  fontSize = TERMINAL_FONT_SIZE_DEFAULT,
  onStatus,
  onSessionId,
  onBusy,
  onExitCode,
  onReattached,
  onCommandExit,
  onAltBuffer,
  onReader,
  onCommandSubmit,
  onOscCommand,
}: SessionProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<{ fit: () => void } | null>(null);
  const termRef = useRef<{ focus: () => void; getSelection: () => string } | null>(null);
  const sessionIdRef = useRef<string | null>(attachSessionId ?? null);
  const lastOutputAtRef = useRef<number | null>(null);
  const lastInputAtRef = useRef<number | null>(null);
  const socketWriteRef = useRef<((data: string) => boolean) | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const findInputRef = useRef<HTMLInputElement>(null);
  const searchAddonRef = useRef<{
    findNext: (term: string) => boolean;
    findPrevious: (term: string) => boolean;
    clearDecorations?: () => void;
  } | null>(null);
  const onStatusRef = useLatestRef(onStatus);
  const onSessionIdRef = useLatestRef(onSessionId);
  const onBusyRef = useLatestRef(onBusy);
  const onExitCodeRef = useLatestRef(onExitCode);
  const onReattachedRef = useLatestRef(onReattached);
  const onCommandExitRef = useLatestRef(onCommandExit);
  const onAltBufferRef = useLatestRef(onAltBuffer);
  const onReaderRef = useLatestRef(onReader);
  const onCommandSubmitRef = useLatestRef(onCommandSubmit);
  const onOscCommandRef = useLatestRef(onOscCommand);
  const killOnUnmountRef = useLatestRef(killOnUnmount);
  const autoFocusRef = useLatestRef(autoFocus);

  // Zoom: update the live terminal and refit without touching the session.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    (term as unknown as { options: { fontSize: number } }).options.fontSize = fontSize;
    fitRef.current?.fit();
  }, [fontSize]);

  // ⌘F opens find — only when the terminal grid itself has focus, so other
  // UI (command palette, chat composer) keeps browser/its own behaviour.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (!((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") || e.altKey || e.shiftKey) {
        return;
      }
      const target = e.target as HTMLElement | null;
      if (!target?.closest?.(".terminal-host")) return;
      e.preventDefault();
      e.stopPropagation();
      setFindOpen(true);
      window.setTimeout(() => findInputRef.current?.select(), 0);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && findOpen) {
        setFindOpen(false);
        termRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("keydown", onEsc);
    };
  }, [active, findOpen]);

  const runFind = (direction: "next" | "prev") => {
    const addon = searchAddonRef.current;
    if (!addon || !findQuery) return;
    if (direction === "next") addon.findNext(findQuery);
    else addon.findPrevious(findQuery);
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;
    let socketRef: WebSocket | null = null;
    const preferKillRef = { current: killOnUnmountRef.current };
    let busyTimer: number | undefined;
    let lastBusy: boolean | null = null;

    const emitBusy = () => {
      const busy = isTerminalBusy({
        lastOutputAt: lastOutputAtRef.current,
        lastInputAt: lastInputAtRef.current,
      });
      if (lastBusy === busy) return;
      lastBusy = busy;
      onBusyRef.current?.(busy);
    };

    /**
     * Record I/O and re-check busy once the stream goes quiet. Every read and
     * write path needs this exact bookkeeping, so it lives in one place.
     */
    const touchActivity = (direction: "input" | "output") => {
      const now = Date.now();
      if (direction === "input") lastInputAtRef.current = now;
      else lastOutputAtRef.current = now;
      emitBusy();
      window.clearTimeout(busyTimer);
      busyTimer = window.setTimeout(emitBusy, 1_400);
    };

    void (async () => {
      const [{ Terminal }, { FitAddon }, { SearchAddon }, { WebLinksAddon }, { Unicode11Addon }] =
        await Promise.all([
          import("@xterm/xterm"),
          import("@xterm/addon-fit"),
          import("@xterm/addon-search"),
          import("@xterm/addon-web-links"),
          import("@xterm/addon-unicode11"),
        ]);
      if (disposed) return;

      const term = new Terminal({
        cursorBlink: true,
        fontFamily: TERMINAL_FONT,
        fontSize,
        lineHeight: 1.2,
        scrollback: TERMINAL_SCROLLBACK,
        // Unicode11Addon registers width providers via the proposed API.
        allowProposedApi: true,
        theme: {
          background: cssVar("--bg-surface", "#11161b"),
          foreground: cssVar("--text", "#e6edf3"),
          cursor: cssVar("--accent", "#9ed84a"),
          selectionBackground: cssVar("--accent-dim", "rgba(158,216,74,0.25)"),
        },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      const search = new SearchAddon();
      term.loadAddon(search);
      searchAddonRef.current = search;
      // unicode11 fixes p10k/Nerd Font glyph widths; web-links makes URLs clickable.
      term.loadAddon(new Unicode11Addon());
      term.loadAddon(new WebLinksAddon());
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

      const dragLayer = document.createElement("div");
      dragLayer.className = "terminal-sel-drag-layer";
      host.appendChild(dragLayer);
      let paintTimer: number | undefined;
      const paintDragLayer = () => {
        const text = term.getSelection()?.trim() ?? "";
        const pos = term.getSelectionPosition();
        dragLayer.replaceChildren();
        host.classList.toggle("has-selection", Boolean(text));
        if (!text || !pos) return;
        const screen = host.querySelector(".xterm-screen") as HTMLElement | null;
        const box = (screen ?? host).getBoundingClientRect();
        const hostBox = host.getBoundingClientRect();
        const cellW = box.width / term.cols;
        const cellH = box.height / term.rows;
        const originX = box.left - hostBox.left;
        const originY = box.top - hostBox.top;
        const viewTop = term.buffer.active.viewportY;
        const startY = pos.start.y - 1;
        const endY = pos.end.y - 1;
        const startX = pos.start.x - 1;
        const endX = pos.end.x - 1;
        for (let y = startY; y <= endY; y++) {
          const viewRow = y - viewTop;
          if (viewRow < 0 || viewRow >= term.rows) continue;
          const col0 = y === startY ? startX : 0;
          const col1 = y === endY ? endX : term.cols;
          const el = document.createElement("div");
          el.className = "terminal-sel-drag";
          el.draggable = true;
          el.setAttribute("role", "button");
          el.setAttribute("aria-label", "Drag terminal selection");
          el.style.left = `${originX + col0 * cellW}px`;
          el.style.top = `${originY + viewRow * cellH}px`;
          el.style.width = `${Math.max(col1 - col0, 1) * cellW}px`;
          el.style.height = `${cellH}px`;
          dragLayer.appendChild(el);
        }
      };
      const schedulePaint = () => {
        window.clearTimeout(paintTimer);
        paintTimer = window.setTimeout(paintDragLayer, 60);
      };
      const selSub = term.onSelectionChange(schedulePaint);
      const scrollSub = term.onScroll(schedulePaint);
      const onDragStart = (e: DragEvent) => {
        const text = term.getSelection()?.trim() ?? "";
        if (!text || !e.dataTransfer) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData(TERMINAL_SELECTION_MIME, text);
        e.dataTransfer.setData(TERMINAL_SELECTION_MIME_LEGACY, text);
        e.dataTransfer.setData("text/plain", text);
        e.dataTransfer.effectAllowed = "copy";
        setTerminalSelectionDrag(true, text);
        host.classList.add("is-dragging-selection");
      };
      const onDragEnd = () => {
        setTerminalSelectionDrag(false);
        host.classList.remove("is-dragging-selection");
      };
      dragLayer.addEventListener("dragstart", onDragStart);
      dragLayer.addEventListener("dragend", onDragEnd);

      const disposeSession = () => {
        preferKillRef.current = true;
        const socket = socketRef;
        if (!socket) return;
        if (socket.readyState === WebSocket.OPEN) {
          try {
            socket.send(JSON.stringify({ type: "dispose" }));
          } catch {
            /* ignore */
          }
        }
        try {
          socket.close();
        } catch {
          /* ignore */
        }
      };

      const writeStdin = (data: string) => {
        const socket = socketRef;
        if (!socket || socket.readyState !== WebSocket.OPEN) return false;
        touchActivity("input");
        socket.send(data);
        return true;
      };
      socketWriteRef.current = writeStdin;

      const getViewport = () => {
        const buffer = term.buffer.active;
        const rows: string[] = [];
        const top = buffer.viewportY;
        for (let i = 0; i < term.rows; i++) {
          rows.push(buffer.getLine(top + i)?.translateToString(true) ?? "");
        }
        return rows.join("\n").replace(/\n+$/, "");
      };

      // Flips true on live OSC 133 traffic — dock stands down heuristics then.
      let sawOsc133 = false;
      /** Server-asserted: this session was spawned with OSC 133 hooks. */
      let serverIntegrated = false;

      onReaderRef.current?.({
        getBuffer: getText,
        getSelection: () => term.getSelection(),
        getViewport,
        sessionId: () => sessionIdRef.current,
        dispose: disposeSession,
        write: writeStdin,
        isBusy: () =>
          isTerminalBusy({
            lastOutputAt: lastOutputAtRef.current,
            lastInputAt: lastInputAtRef.current,
          }),
        scrollToLine: (line: number) => {
          term.scrollToLine(Math.max(0, Math.min(line, term.buffer.active.length - 1)));
        },
        cursorLine: () => {
          const buffer = term.buffer.active;
          return buffer.baseY + buffer.cursorY;
        },
        hasShellIntegration: () => sawOsc133 || serverIntegrated,
        openFind: () => {
          setFindOpen(true);
          window.setTimeout(() => findInputRef.current?.select(), 0);
        },
      });

      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const params = new URLSearchParams({ shell: "login" });
      if (cwd) params.set("cwd", cwd);
      if (attachSessionId) params.set("attach", attachSessionId);

      /**
       * In the desktop app the PTY requires a ticket, not the bootstrap cookie.
       * WKWebView does not attach that cookie to a `ws://` handshake on a
       * different port, so a cookie-based check rejected every connection and
       * the terminal was simply broken in the shipped app.
       *
       * The ticket is fetched over same-origin HTTP, where the cookie does
       * work. In browser mode the route reports `desktop: false` and returns
       * no ticket, so `npm run dev` is unaffected.
       */
      let ticket: string | null = null;
      try {
        const res = await fetch("/api/desktop/terminal-ticket", { credentials: "same-origin" });
        if (res.ok) ticket = ((await res.json()) as { ticket: string | null }).ticket;
      } catch {
        /* browser mode, or the route is unavailable — origin checking applies */
      }
      if (disposed) return;
      if (ticket) params.set("ticket", ticket);

      const socket = new WebSocket(
        `${proto}://${window.location.hostname}:${TERMINAL_PORT}/?${params}`,
      );
      socketRef = socket;
      if (disposed || preferKillRef.current) {
        disposeSession();
        term.dispose();
        return;
      }

      const sendResize = () => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      };

      let reattached = false;
      /**
       * Reattach replays the on-disk log tail into xterm, and the replayed
       * bytes carry the old session's OSC 133 marks — without a suppress
       * window every historical command re-creates a block on reload.
       */
      let suppressBlocksUntil = 0;
      let ranCommand = false;
      let opened = false;
      let reportedClose = false;

      socket.onopen = () => {
        if (disposed) return;
        opened = true;
        onStatusRef.current?.("open");
        fit.fit();
        sendResize();
        // Launch commands only on fresh sessions — reattach already has the
        // process running (and re-sending would restart a long-running command).
        if (!reattached && !attachSessionId && command?.trim() && !ranCommand) {
          ranCommand = true;
          socket.send("stty -echo\r");
          window.setTimeout(() => {
            if (socket.readyState !== WebSocket.OPEN) return;
            socket.send(`clear\r${command.trim()}; stty echo\r`);
          }, 50);
        }
        if (autoFocusRef.current) term.focus();
      };
      socket.onmessage = (event) => {
        // Control frames (session/fallback/exited) are dock-internal noise —
        // swallow them; everything else is bytes for the terminal. The session
        // frame carries the id used to fetch the full on-disk log for copy-all.
        if (typeof event.data === "string" && event.data.startsWith('{"devhubCtl"')) {
          try {
            const ctl = JSON.parse(event.data) as {
              type?: string;
              sessionId?: string;
              reattached?: boolean;
              exitCode?: number;
              integrated?: boolean;
            };
            if (ctl.type === "session" && typeof ctl.sessionId === "string") {
              sessionIdRef.current = ctl.sessionId;
              onSessionIdRef.current?.(ctl.sessionId);
              if (ctl.integrated) serverIntegrated = true;
              if (ctl.reattached) {
                reattached = true;
                suppressBlocksUntil = Date.now() + 2_500;
                onReattachedRef.current?.(true);
              }
            }
            if (ctl.type === "exited" && typeof ctl.exitCode === "number") {
              onExitCodeRef.current?.(ctl.exitCode);
            }
          } catch {
            /* ignore malformed control frame */
          }
          return;
        }
        touchActivity("output");
        term.write(event.data as string);
      };
      /**
       * A refused handshake used to leave an empty black pane and a grey dot.
       * The browser deliberately hides the HTTP status from script, so say what
       * was attempted and what usually causes it — the peer rejects any origin
       * whose port is not the dashboard's own (see verifyTerminalClient).
       */
      const reportDisconnect = () => {
        if (disposed || reportedClose) return;
        reportedClose = true;
        onStatusRef.current?.("closed");
        if (opened) {
          term.writeln("");
          term.writeln("\x1b[2m── session ended · Restart to start a new shell ──\x1b[0m");
          return;
        }
        const url = `${window.location.hostname}:${TERMINAL_PORT}`;
        term.writeln("");
        term.writeln(`\x1b[31m⚠ Could not reach the terminal peer at ${url}.\x1b[0m`);
        term.writeln("\x1b[2mUsually one of:\x1b[0m");
        term.writeln("\x1b[2m  · the PTY server is not running — start it with `npm run dev`\x1b[0m");
        term.writeln(
          `\x1b[2m  · it is running but expects a different dashboard port; this page is\x1b[0m`,
        );
        term.writeln(
          `\x1b[2m    on ${window.location.port || "80"}, so start it with PORT=${window.location.port || "80"}\x1b[0m`,
        );
        term.writeln(
          `\x1b[2m  · set NEXT_PUBLIC_TERMINAL_PORT if the peer is not on ${TERMINAL_PORT}\x1b[0m`,
        );
      };
      socket.onclose = reportDisconnect;
      socket.onerror = reportDisconnect;

      let typedAccum = "";
      const dataSub = term.onData((data) => {
        touchActivity("input");
        if (socket.readyState === WebSocket.OPEN) socket.send(data);
        if (Date.now() < suppressBlocksUntil) return;
        const next = applyTypedInput(typedAccum, data);
        typedAccum = next.accum;
        if (next.submitted) {
          const submitted = next.submitted;
          const record = () => {
            if (shouldRecordTypedCommand(submitted, lastNonEmptyLine(getText()))) {
              onCommandSubmitRef.current?.(submitted);
              return true;
            }
            return false;
          };
          if (!record()) window.setTimeout(record, 16);
        }
      });

      const oscSub = term.parser.registerOscHandler(133, (payload) => {
        if (Date.now() < suppressBlocksUntil) return true;
        const parsed = parseOsc133(payload);
        if (!parsed) return true;
        if (parsed.kind === "C") {
          sawOsc133 = true;
          const cmd = commandFromPromptLine(lastNonEmptyLine(getText()));
          if (cmd) onOscCommandRef.current?.(cmd);
        }
        if (parsed.kind === "D" && parsed.exitCode != null) {
          sawOsc133 = true;
          onCommandExitRef.current?.(parsed.exitCode);
        }
        return true;
      });

      // Full-screen apps (vim, htop) take the alternate buffer — report it so
      // the dock can drop out of blocks view until they exit.
      let lastAlt = isAltBuffer(term);
      onAltBufferRef.current?.(lastAlt);
      const altTimer = window.setInterval(() => {
        const alt = isAltBuffer(term);
        if (alt !== lastAlt) {
          lastAlt = alt;
          onAltBufferRef.current?.(alt);
        }
      }, 800);

      const onResize = () => {
        fit.fit();
        sendResize();
        schedulePaint();
      };
      window.addEventListener("resize", onResize);
      const observer = new ResizeObserver(onResize);
      observer.observe(host);

      cleanup = () => {
        onReaderRef.current?.(null);
        window.clearTimeout(busyTimer);
        window.clearTimeout(paintTimer);
        window.clearInterval(altTimer);
        window.removeEventListener("resize", onResize);
        observer.disconnect();
        dataSub.dispose();
        oscSub.dispose();
        selSub.dispose();
        scrollSub.dispose();
        searchAddonRef.current = null;
        dragLayer.removeEventListener("dragstart", onDragStart);
        dragLayer.removeEventListener("dragend", onDragEnd);
        dragLayer.remove();
        if (preferKillRef.current || killOnUnmountRef.current) {
          disposeSession();
        } else {
          try {
            socket.close();
          } catch {
            /* ignore */
          }
        }
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
      if (autoFocus) termRef.current?.focus();
    }, 30);
    return () => clearTimeout(t);
  }, [active, autoFocus]);

  return (
    <div className="terminal-host-wrap" style={{ height: "100%", position: "relative" }}>
      {findOpen && (
        <div className="terminal-find-bar" role="search" aria-label="Find in terminal">
          <input
            ref={findInputRef}
            className="terminal-find-input"
            value={findQuery}
            placeholder="Find in output"
            aria-label="Find in terminal output"
            onChange={(e) => {
              setFindQuery(e.target.value);
              if (e.target.value) searchAddonRef.current?.findNext(e.target.value);
              else searchAddonRef.current?.clearDecorations?.();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runFind(e.shiftKey ? "prev" : "next");
              }
              if (e.key === "Escape") {
                e.stopPropagation();
                setFindOpen(false);
                termRef.current?.focus();
              }
            }}
          />
          <button
            type="button"
            className="terminal-find-btn"
            aria-label="Previous match"
            onClick={() => runFind("prev")}
          >
            <ChevronUp size={12} aria-hidden />
          </button>
          <button
            type="button"
            className="terminal-find-btn"
            aria-label="Next match"
            onClick={() => runFind("next")}
          >
            <ChevronDown size={12} aria-hidden />
          </button>
          <button
            type="button"
            className="terminal-find-btn"
            aria-label="Close find"
            onClick={() => {
              setFindOpen(false);
              searchAddonRef.current?.clearDecorations?.();
              termRef.current?.focus();
            }}
          >
            <X size={12} aria-hidden />
          </button>
        </div>
      )}
      <div ref={hostRef} className="terminal-host" style={{ height: "100%" }} />
    </div>
  );
}
