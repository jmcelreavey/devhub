"use client";

import { WebSocketTransport } from "@wterm/core";
import type { SearchState, WTerm } from "@wterm/dom";
import { GhosttyCore } from "@wterm/ghostty";
import ghosttyWasmUrl from "@wterm/ghostty/ghostty-vt.wasm?url";
import { Terminal } from "@wterm/react";
import "@wterm/react/css";
import { copyTextToClipboard, readTextFromClipboard } from "@/lib/clipboard";
import { openInBrowser } from "@/lib/desktop/bridge";
import { createOsc133OutputStream, dataTransferHasTerminalSelection, lastNonEmptyLine, looksLikePromptLine, setTerminalSelectionDrag, TERMINAL_SELECTION_MIME, TERMINAL_SELECTION_MIME_LEGACY } from "@/lib/terminal/blocks";
import { isAppleTerminalPlatform, isTerminalCopyShortcut, isTerminalCutShortcut, isTerminalShiftPasteShortcut } from "@/lib/terminal/clipboard";
import { useToast } from "@/lib/hooks/use-toast";
import { isTerminalBusy } from "@/lib/terminal/inject";
import { resolveTerminalUrl } from "@/lib/terminal/terminal-url";
import { collectTerminalPasteImageFiles, formatTerminalImagePathInject, uploadTerminalPasteImages } from "../../../../packages/shared/ui-lib/terminal/paste-image";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type DragEvent as ReactDragEvent } from "react";

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

/** The dock's view of a terminal session and its retained output. */
export interface TerminalReader {
  getBuffer: () => string;
  getSelection: () => string;
  readText: (signal: AbortSignal) => Promise<string>;
  getViewport: () => string;
  sessionId: () => string | null;
  dispose: () => void;
  write: (data: string) => boolean;
  isReadyForInput: () => boolean;
  isBusy: () => boolean;
  openFind: () => void;
  paste: (text: string) => void;
  prepareCut: () => (() => boolean);
  hasShellIntegration: () => boolean;
  selectAll: () => Promise<boolean>;
}

interface WTermSessionProps {
  cwd?: string;
  attachSessionId?: string | null;
  active: boolean;
  autoFocus: boolean;
  fontSize: number;
  onStatus: (status: Status) => void;
  onSessionId: (id: string) => void;
  onCwd: (cwd: string) => void;
  onBusy: (busy: boolean) => void;
  onCommandExit: (code: number) => void;
  onExitCode: (code: number) => void;
  onReattached: (reattached: boolean) => void;
  onReadyForInput: () => void;
  onCommandStart: () => void;
  onUserInput: () => void;
  onReader: (reader: TerminalReader | null) => void;
  onOpenNew: () => void;
}

// Ghostty budgets history in bytes and allocates whole pages; this is not a line count.
const SCROLLBACK_BYTES = 128 * 1024 * 1024;

function bufferLine(core: NonNullable<WTerm["bridge"]>, row: number, history: number): string {
  let line = "";
  const offset = history - row - 1;
  for (let col = 0; col < core.getCols(); col++) {
    const cell = row < history
      ? col < core.getScrollbackLineLen(offset) ? core.getScrollbackCell(offset, col) : null
      : core.getCell(row - history, col);
    if (!cell) line += " ";
    else if (cell.width !== 0 && !cell.spacerHead) line += cell.chars ?? String.fromCodePoint(cell.char || 32);
  }
  return line.trimEnd();
}

function bufferText(term: WTerm, maxLines: number): string {
  const core = term.bridge;
  if (!core) return "";
  const history = core.getScrollbackCount();
  const end = history + core.getRows();
  const lines: string[] = [];
  for (let row = Math.max(0, end - maxLines); row < end; row++) {
    lines.push(bufferLine(core, row, history));
  }
  return lines.join("\n").replace(/\n+$/, "") + "\n";
}

function isAbsoluteCwd(cwd: string): boolean {
  if (cwd.includes("\0")) return false;
  return cwd.startsWith("/") || /^[A-Za-z]:[\\/]/.test(cwd) || /^\\\\[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/.test(cwd);
}

function viewportText(term: WTerm): string {
  const core = term.bridge;
  const rowHeight = Number.parseFloat(getComputedStyle(term.element).getPropertyValue("--term-row-height"));
  if (!core || !rowHeight) return "";
  const history = core.getScrollbackCount();
  const first = Math.max(0, Math.floor(term.element.scrollTop / rowHeight));
  const lines: string[] = [];
  for (let row = first; row < Math.min(history + core.getRows(), first + term.rows); row++) {
    lines.push(bufferLine(core, row, history));
  }
  return lines.join("\n").replace(/\n+$/, "");
}

function cursorPrefix(term: WTerm): string {
  const core = term.bridge;
  if (!core) return "";
  const cursor = core.getCursor();
  let text = "";
  for (let col = 0; col < cursor.col; col++) {
    const cell = core.getCell(cursor.row, col);
    if (cell.width !== 0 && !cell.spacerHead) text += cell.chars ?? String.fromCodePoint(cell.char || 32);
  }
  return text;
}

function prepareWTermCut(term: WTerm, send: (data: string) => boolean, getRevision: () => number): () => boolean {
  const core = term.bridge;
  const revision = getRevision();
  const selection = term.element.ownerDocument.getSelection();
  const text = term.getSelectionText();
  if (!core || !selection || selection.rangeCount !== 1 || !text || /[\r\n]/.test(text)) {
    return () => { term.clearSelection(); return false; };
  }
  const range = selection.getRangeAt(0);
  const row = (range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement)?.closest(".term-row");
  const endRow = (range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement)?.closest(".term-row");
  const grid = row?.parentElement;
  const cursor = core.getCursor();
  if (!row || row !== endRow || !grid?.classList.contains("term-grid") || !term.element.contains(grid) || core.usingAltScreen()) {
    return () => { term.clearSelection(); return false; };
  }
  const height = row.getBoundingClientRect().height;
  const index = height ? Math.round((row.getBoundingClientRect().top - grid.getBoundingClientRect().top) / height) : -1;
  const prefixRange = range.cloneRange();
  prefixRange.selectNodeContents(row);
  prefixRange.setEnd(range.endContainer, range.endOffset);
  const prefix = cursorPrefix(term);
  // Only delete when the selected cells are provably the current input suffix.
  const valid = index === core.getScrollbackCount() + cursor.row &&
    prefixRange.toString() === prefix && range.toString() === text && prefix.endsWith(text);
  return () => {
    term.clearSelection();
    const current = core.getCursor();
    if (!valid || getRevision() !== revision || core.usingAltScreen() || current.row !== cursor.row || current.col !== cursor.col || cursorPrefix(term) !== prefix) return false;
    return send("\x7f".repeat([...text].length));
  };
}

/** Resolve a click from Ghostty cells, including confirmed soft wraps. */
function plainLinkAt(term: WTerm, target: EventTarget | null, x: number): string | null {
  const core = term.bridge;
  if (!core || !(target instanceof Element)) return null;
  const rowElement = target.closest(".term-row");
  const grid = rowElement?.parentElement;
  if (!(rowElement instanceof HTMLElement) || !grid?.classList.contains("term-grid") || !term.element.contains(grid)) return null;
  // Image flow changes row geometry; do not guess which retained row was clicked.
  if (Array.from(grid.querySelectorAll<HTMLElement>(".term-image-flow-spacer")).some((el) => el.offsetHeight > 0)) return null;
  const rowHeight = rowElement.getBoundingClientRect().height;
  const cellWidth = Number.parseFloat(getComputedStyle(term.element).getPropertyValue("--term-cell-width"));
  if (!rowHeight || !cellWidth) return null;
  const history = core.getScrollbackCount();
  const total = history + core.getRows();
  const cols = core.getCols();
  const row = Math.round((rowElement.getBoundingClientRect().top - grid.getBoundingClientRect().top) / rowHeight);
  const col = Math.floor((x - rowElement.getBoundingClientRect().left) / cellWidth);
  if (row < 0 || row >= total || col < 0 || col >= cols) return null;

  const metadata = (index: number) => index < history
    ? core.getScrollbackLineLen(history - index - 1) <= cols
      ? core.getScrollbackRowMetadata?.(history - index - 1) : null
    : core.getRowMetadata?.(index - history);
  const wraps = (index: number) => index >= 0 && index + 1 < total &&
    metadata(index)?.wrapsToNext && metadata(index + 1)?.continuesPrevious;
  let first = row;
  let last = row;
  while (first > 0 && wraps(first - 1) && row - first < 15) first--;
  while (last + 1 < total && wraps(last) && last - first < 15) last++;
  if (wraps(first - 1) || wraps(last)) return null;

  const cell = (index: number, column: number) => index < history
    ? column < core.getScrollbackLineLen(history - index - 1)
      ? core.getScrollbackCell(history - index - 1, column) : null
    : core.getCell(index - history, column);
  let text = "";
  let hit = -1;
  const paintedRows = new Map<number, string>();
  for (let index = first; index <= last; index++) {
    let paintedRow = "";
    for (let column = 0; column < cols; column++) {
      const value = cell(index, column);
      if (index === row && column === col) hit = text.length;
      if (!value) {
        text += " ";
        paintedRow += " ";
        continue;
      }
      if (value.width === 0 || value.spacerHead) continue;
      const chars = value.chars ?? String.fromCodePoint(value.char || 32);
      text += chars;
      paintedRow += chars;
      if (text.length > 8192) return null;
    }
    paintedRows.set(index, paintedRow.trimEnd());
  }
  // A write may be waiting to repaint. Require every wrapped row to match.
  for (const mounted of grid.querySelectorAll<HTMLElement>(".term-row")) {
    const index = Math.round((mounted.getBoundingClientRect().top - grid.getBoundingClientRect().top) / rowHeight);
    if (!paintedRows.has(index)) continue;
    if ((mounted.textContent ?? "").trimEnd() !== paintedRows.get(index)) return null;
    paintedRows.delete(index);
  }
  if (paintedRows.size) return null;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
    const start = match.index ?? 0;
    if (start > 0 && /[\w/:@]/.test(text[start - 1]!)) continue;
    const candidate = match[0].replace(/[.,;!?\])}]+$/, "");
    if (hit < start || hit >= start + candidate.length) continue;
    try {
      const url = new URL(candidate);
      if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname) return url.href;
    } catch {
      return null;
    }
  }
  return null;
}

function textFrame(text: string): Uint8Array {
  const encoded = new TextEncoder().encode(text);
  if (encoded.length > 1024 * 1024) throw new RangeError("Terminal input is too large");
  const frame = new Uint8Array(encoded.length + 4);
  frame.set([0x57, 0x54, 0x54, 1]);
  frame.set(encoded, 4);
  return frame;
}

interface WTermConnectionOptions {
  cwd?: string;
  sessionId?: string | null;
  onStatus: (status: Status) => void;
  onSession: (sessionId: string, cwd?: string, integrated?: boolean) => void;
  onReplayStart: () => void;
  onReplayEnd: () => void;
  onAttached: (reattached: boolean) => void;
  onOutput: (data: string | Uint8Array, replay: boolean) => void;
  onControl: (control: { type?: string; exitCode?: number; to?: string }) => void;
  onWarning: (message: string) => void;
  onMissing: () => void;
}

/** One transport per attempt; its queue must never survive a disconnect. */
export function createWTermConnection(options: WTermConnectionOptions) {
  let sessionId = options.sessionId ?? null;
  let transport: WebSocketTransport | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  let ticketRequest: AbortController | null = null;
  let stopped = false;
  let attached = false;
  let replay = false;
  let delay = 1000;

  const schedule = () => {
    if (stopped) return;
    options.onStatus("connecting");
    timer = setTimeout(() => { timer = null; void connect(); }, delay);
    delay = Math.min(delay * 2, 30_000);
  };

  const connect = async () => {
    const expectedSession = sessionId;
    const params = new URLSearchParams({ shell: "login", engine: "wterm" });
    if (options.cwd) params.set("cwd", options.cwd);
    if (expectedSession) {
      params.set("attach", expectedSession);
      params.set("strictAttach", "1");
    }
    let port = process.env.NEXT_PUBLIC_TERMINAL_PORT ?? "1339";
    let terminalUrl: string | null = null;
    let ticket: string | null = null;
    let ticketPort: number | undefined;
    const request = new AbortController();
    ticketRequest = request;
    const timeout = setTimeout(() => request.abort(), 10_000);
    try {
      const response = await fetch("/api/desktop/terminal-ticket", { credentials: "same-origin", signal: request.signal });
      if (!response.ok) throw new Error("Terminal ticket request failed");
      const data = await response.json() as { ticket: string | null; desktop?: boolean; port?: number; terminalUrl?: string | null };
      if (data.desktop && !data.ticket) throw new Error("Terminal ticket missing");
      ticket = data.ticket;
      terminalUrl = typeof data.terminalUrl === "string" ? data.terminalUrl : null;
      if (typeof data.port === "number" && Number.isInteger(data.port) && data.port >= 1 && data.port <= 65535) {
        ticketPort = data.port;
        if (!process.env.NEXT_PUBLIC_TERMINAL_PORT) port = String(data.port);
      }
    } catch {
      if (!stopped) {
        options.onWarning("Could not obtain a terminal connection ticket. Retrying.");
        schedule();
      }
      return;
    } finally {
      clearTimeout(timeout);
      if (ticketRequest === request) ticketRequest = null;
    }
    if (stopped) return;
    let socketUrl: string;
    try {
      socketUrl = resolveTerminalUrl(terminalUrl, window.location, port, params, ticket, ticketPort);
    } catch {
      stopped = true;
      options.onStatus("closed");
      options.onWarning("TERMINAL_URL must be a valid ws:// or wss:// URL without a fragment.");
      return;
    }
    let opened = false;
    let missing = false;
    const current = new WebSocketTransport({
      url: socketUrl,
      reconnect: false,
      onOpen: () => { opened = true; },
      onData: (data) => {
        if (typeof data === "string" && data.startsWith('{"devhubCtl"')) {
          try {
            const ctl = JSON.parse(data) as { type?: string; sessionId?: string; cwd?: string; reattached?: boolean; integrated?: boolean; exitCode?: number; to?: string };
            if (ctl.type === "attach-missing") {
              missing = true;
              stopped = true;
              attached = false;
              options.onStatus("closed");
              options.onMissing();
              current.close();
            } else if (ctl.type === "session" && typeof ctl.sessionId === "string") {
              if (expectedSession && (ctl.sessionId !== expectedSession || !ctl.reattached)) {
                missing = true;
                stopped = true;
                options.onStatus("closed");
                options.onMissing();
                current.close();
                return;
              }
              sessionId = ctl.sessionId;
              options.onSession(ctl.sessionId, ctl.cwd, ctl.integrated);
              if (ctl.reattached) {
                replay = true;
                options.onReplayStart();
              } else {
                attached = true;
                if (handshakeTimer) clearTimeout(handshakeTimer);
                handshakeTimer = null;
                delay = 1000;
                options.onStatus("open");
                options.onAttached(false);
              }
            } else if (ctl.type === "replay-end" && replay) {
              replay = false;
              options.onReplayEnd();
              attached = true;
              if (handshakeTimer) clearTimeout(handshakeTimer);
              handshakeTimer = null;
              delay = 1000;
              options.onStatus("open");
              options.onAttached(true);
            } else {
              options.onControl(ctl);
            }
          } catch {
            // Ignore malformed peer control messages.
          }
          return;
        }
        options.onOutput(data, replay);
      },
      onBackpressure: (paused) => {
        if (paused) options.onWarning("The terminal is busy sending input; further input will be rejected.");
      },
      onClose: () => {
        attached = false;
        replay = false;
        if (handshakeTimer) clearTimeout(handshakeTimer);
        handshakeTimer = null;
        current.close();
        if (transport === current) transport = null;
        if (stopped || missing) return;
        options.onWarning("Terminal disconnected. Queued input may not have arrived and was not resent.");
        // Once an initial socket opened, a shell may exist even if its ID was lost.
        if (opened && !sessionId) {
          stopped = true;
          options.onStatus("closed");
          options.onMissing();
          return;
        }
        schedule();
      },
      onError: () => {
        if (!stopped) options.onWarning(terminalUrl ? "Could not connect to the terminal peer." : "Could not connect to the local terminal peer.");
      },
    });
    transport = current;
    try {
      current.connect();
      handshakeTimer = setTimeout(() => current.close(), 15_000);
    } catch {
      transport = null;
      current.close();
      options.onWarning(terminalUrl ? "Could not connect to the terminal peer." : "Could not connect to the local terminal peer.");
      schedule();
    }
  };

  const send = (data: string | Uint8Array): boolean => {
    if (!attached || !transport?.connected || transport.backpressured) {
      options.onWarning("Input was not sent. The terminal is disconnected or busy.");
      return false;
    }
    try {
      transport.send(typeof data === "string" ? textFrame(data) : data);
      return true;
    } catch {
      options.onWarning("Input was not sent. The terminal's send buffer is full.");
      return false;
    }
  };

  const stop = (dispose: boolean) => {
    stopped = true;
    ticketRequest?.abort();
    if (timer) clearTimeout(timer);
    if (handshakeTimer) clearTimeout(handshakeTimer);
    const current = transport;
    transport = null;
    if (!current) return;
    if (!dispose || !attached || !current.connected) {
      current.close();
      return;
    }
    try {
      current.send(textFrame(JSON.stringify({ type: "dispose" })));
      const deadline = Date.now() + 2000;
      const closeAfterDrain = () => {
        if (current.queuedMessages === 0 || Date.now() >= deadline || !current.connected) current.close();
        else setTimeout(closeAfterDrain, 25);
      };
      closeAfterDrain();
    } catch {
      current.close();
      options.onWarning("Could not close the shell. It will expire after disconnecting.");
    }
  };

  void connect();
  return { send, stop, isAttached: () => attached };
}

/** One core and one PTY connection per mounted tab. */
export function WTermSession(props: WTermSessionProps) {
  const propsRef = useRef(props);
  useLayoutEffect(() => { propsRef.current = props; });
  const [core, setCore] = useState<GhosttyCore | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionUnavailable, setSessionUnavailable] = useState(false);
  const [inputWarning, setInputWarning] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findError, setFindError] = useState<string | null>(null);
  const [searchState, setSearchState] = useState<SearchState | null>(null);
  const findRef = useRef({ open: findOpen, query: findQuery, error: findError });
  useLayoutEffect(() => { findRef.current = { open: findOpen, query: findQuery, error: findError }; });
  const hostRef = useRef<HTMLDivElement | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const connectionRef = useRef<ReturnType<typeof createWTermConnection> | null>(null);
  const termRef = useRef<WTerm | null>(null);
  const disposedRef = useRef(false);
  const connectingRef = useRef(false);
  const sessionCleanupRef = useRef<(() => void) | null>(null);
  const touchInputRef = useRef<() => void>(() => {});
  const activityRevisionRef = useRef(0);
  const pasteBusyRef = useRef(false);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    disposedRef.current = false;
    void GhosttyCore.load({ scrollbackLimit: SCROLLBACK_BYTES, wasmPath: ghosttyWasmUrl }).then((loaded) => {
      if (cancelled) loaded.dispose();
      else setCore(loaded);
    }).catch((cause: unknown) => {
      if (!cancelled) {
        setError(cause instanceof Error ? cause.message : "Could not load the terminal engine.");
        propsRef.current.onStatus("closed");
      }
    });
    return () => {
      cancelled = true;
      disposedRef.current = true;
      sessionCleanupRef.current?.();
      propsRef.current.onReader(null);
      connectionRef.current?.stop(false);
      connectionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!core) return;
    return () => core.dispose();
  }, [core]);

  const send = useCallback((data: string | Uint8Array): boolean => {
    const connection = connectionRef.current;
    if (!connection) {
      setInputWarning("Input was not sent. The terminal is disconnected or busy.");
      return false;
    }
    const sent = connection.send(data);
    if (sent) touchInputRef.current();
    return sent;
  }, []);

  const paste = useCallback((text: string) => {
    const term = termRef.current;
    if (!term?.bridge || !text || !propsRef.current.active || disposedRef.current) return;
    const input = term.bridge.bracketedPaste() ? `\x1b[200~${text}\x1b[201~` : text;
    if (send(input)) {
      propsRef.current.onUserInput();
      term.clearSelection();
      term.focus();
    }
  }, [send]);

  const sendEditing = useCallback((data: string): boolean => {
    if (!send(data)) return false;
    propsRef.current.onUserInput();
    return true;
  }, [send]);

  const search = useCallback((term: WTerm, query: string) => {
    try {
      term.search(query);
      setFindError(null);
    } catch (cause) {
      term.clearSearch();
      setFindError(cause instanceof RangeError ? "Search is limited to 1,024 UTF-16 units." : "Couldn't search terminal output.");
    }
  }, []);

  const dispose = useCallback(() => {
    connectionRef.current?.stop(true);
    connectionRef.current = null;
  }, []);

  const injectPastedImages = useCallback(async (files: File[]) => {
    if (files.length === 0 || pasteBusyRef.current) return;
    pasteBusyRef.current = true;
    try {
      const result = await uploadTerminalPasteImages(files);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (!sendEditing(formatTerminalImagePathInject(result.paths))) {
        toast.error("Terminal isn’t connected — couldn’t inject image path.");
        return;
      }
      toast.success(result.paths.length === 1 ? "Image path inserted" : `${result.paths.length} image paths inserted`);
    } finally {
      pasteBusyRef.current = false;
    }
  }, [sendEditing, toast]);

  const onPasteCapture = useCallback((event: ReactClipboardEvent) => {
    const images = collectTerminalPasteImageFiles(event.clipboardData);
    if (!images.length) return;
    event.preventDefault();
    event.stopPropagation();
    void injectPastedImages(images);
  }, [injectPastedImages]);

  const onDragOverImages = useCallback((event: ReactDragEvent) => {
    if (dataTransferHasTerminalSelection(event.dataTransfer) || !Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onDropImages = useCallback((event: ReactDragEvent) => {
    if (dataTransferHasTerminalSelection(event.dataTransfer) || !Array.from(event.dataTransfer.types).includes("Files")) return;
    // Prevent the browser navigating to a dropped non-image file too.
    event.preventDefault();
    event.stopPropagation();
    void injectPastedImages(collectTerminalPasteImageFiles(event.dataTransfer));
  }, [injectPastedImages]);

  const setupTerminal = useCallback((term: WTerm) => {
    if (termRef.current !== term || disposedRef.current) return;
    term.onSearchChange = setSearchState;
    if (connectingRef.current) return;
    connectingRef.current = true;
    let sessionId: string | null = propsRef.current.attachSessionId ?? null;
    let integrated = false;
    let sawOsc = false;
    let shellReady = false;
    let commandRunning: boolean | null = null;
    let lastBusy: boolean | null = null;
    let lastInputAt: number | null = null;
    let lastOutputAt: number | null = null;
    let busyTimer: number | undefined;
    let replayRunning: boolean | null = null;
    let replayExit: number | undefined;
    let runningBeforeReplay = false;
    const host = hostRef.current;
    const dragLayer = document.createElement("div");
    dragLayer.className = "terminal-sel-drag-layer";
    // Keep it inside wterm so a secondary click preserves virtual selections.
    term.element.appendChild(dragLayer);
    let paintTimer: number | undefined;
    let dragging = false;
    let armed = false;
    let selectedText = "";
    const placeDragLayer = () => {
      dragLayer.style.top = `${term.element.scrollTop}px`;
      dragLayer.style.left = `${term.element.scrollLeft}px`;
      dragLayer.style.right = "auto";
      dragLayer.style.bottom = "auto";
      dragLayer.style.width = `${term.element.clientWidth}px`;
      dragLayer.style.height = `${term.element.clientHeight}px`;
    };
    const paintSelection = () => {
      if (!host || dragging || armed) return;
      placeDragLayer();
      const selection = document.getSelection();
      const text = term.getSelectionText() ?? "";
      selectedText = text;
      dragLayer.replaceChildren();
      host.classList.toggle("has-selection", Boolean(text.trim()));
      if (!text.trim()) return;
      const viewport = term.element.getBoundingClientRect();
      const addOverlay = (box: { left: number; right: number; top: number; bottom: number }) => {
        const left = Math.max(box.left, viewport.left);
        const right = Math.min(box.right, viewport.right);
        const top = Math.max(box.top, viewport.top);
        const bottom = Math.min(box.bottom, viewport.bottom);
        if (right <= left || bottom <= top) return;
        const overlay = document.createElement("div");
        overlay.className = "terminal-sel-drag";
        overlay.draggable = true;
        overlay.setAttribute("role", "button");
        overlay.setAttribute("aria-label", "Drag terminal selection");
        overlay.style.left = `${left - viewport.left - term.element.clientLeft}px`;
        overlay.style.top = `${top - viewport.top - term.element.clientTop}px`;
        overlay.style.width = `${right - left}px`;
        overlay.style.height = `${bottom - top}px`;
        dragLayer.appendChild(overlay);
      };
      if (selection && selection.rangeCount === 1 && term.element.contains(selection.anchorNode)) {
        // Native range rectangles preserve geometry across wrapped rows.
        for (const box of Array.from(selection.getRangeAt(0).getClientRects())) addOverlay(box);
      } else {
        // Select-all and rectangular selections use virtual row highlights.
        const rows = term.element.classList.contains("term-select-all")
          ? term.element.querySelectorAll<HTMLElement>(".term-row")
          : term.element.querySelectorAll<HTMLElement>(".term-rectangle-row");
        for (const row of rows) {
          const box = row.getBoundingClientRect();
          const left = Number.parseFloat(row.style.getPropertyValue("--term-selection-left")) || 0;
          const width = Number.parseFloat(row.style.getPropertyValue("--term-selection-width")) || box.width;
          addOverlay({ left: box.left + left, right: box.left + left + width, top: box.top, bottom: box.bottom });
        }
      }
    };
    const scheduleSelectionPaint = () => {
      if (!armed && !dragging && selectedText && !term.getSelectionText()) {
        selectedText = "";
        dragLayer.replaceChildren();
        host?.classList.remove("has-selection");
      }
      window.clearTimeout(paintTimer);
      paintTimer = window.setTimeout(paintSelection, 60);
    };
    const onDragStart = (event: globalThis.DragEvent) => {
      // Wterm clears a virtual selection on pointerdown, before dragstart.
      const text = selectedText;
      if (!text || !event.dataTransfer) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.setData(TERMINAL_SELECTION_MIME, text);
      event.dataTransfer.setData(TERMINAL_SELECTION_MIME_LEGACY, text);
      event.dataTransfer.setData("text/plain", text);
      event.dataTransfer.effectAllowed = "copy";
      dragging = true;
      setTerminalSelectionDrag(true, text);
      host?.classList.add("is-dragging-selection");
    };
    const onDragEnd = () => {
      dragging = false;
      armed = false;
      setTerminalSelectionDrag(false);
      host?.classList.remove("is-dragging-selection");
      scheduleSelectionPaint();
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      term.element.scrollBy({ top: event.deltaY, left: event.deltaX });
      scheduleSelectionPaint();
    };
    const onSelectionClick = () => {
      term.clearSelection();
      selectedText = "";
      paintSelection();
    };
    const onSelectionPointerDown = () => { armed = true; };
    const onSelectionPointerUp = () => {
      if (dragging) return;
      armed = false;
      scheduleSelectionPaint();
    };
    const onScroll = () => {
      placeDragLayer();
      if (!dragging && !armed) dragLayer.replaceChildren();
      scheduleSelectionPaint();
    };
    const selectionObserver = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => {
        const target = mutation.target;
        if (!(target instanceof HTMLElement)) return false;
        return target === term.element || target.classList.contains("term-rectangle-row") || mutation.oldValue?.includes("term-rectangle-row");
      })) scheduleSelectionPaint();
    });
    selectionObserver.observe(term.element, { attributes: true, attributeFilter: ["class"], attributeOldValue: true, subtree: true });
    document.addEventListener("selectionchange", scheduleSelectionPaint);
    term.element.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", scheduleSelectionPaint);
    dragLayer.addEventListener("dragstart", onDragStart);
    dragLayer.addEventListener("dragend", onDragEnd);
    dragLayer.addEventListener("pointerdown", onSelectionPointerDown);
    window.addEventListener("pointerup", onSelectionPointerUp);
    dragLayer.addEventListener("wheel", onWheel);
    dragLayer.addEventListener("click", onSelectionClick);
    const isBusy = () => isTerminalBusy({
      lastInputAt, lastOutputAt, commandRunning,
      promptVisible: () => looksLikePromptLine(lastNonEmptyLine(bufferText(term, 2))),
    });
    const emitBusy = () => {
      if (!connectionRef.current?.isAttached()) return;
      const busy = isBusy();
      if (busy === lastBusy) return;
      lastBusy = busy;
      propsRef.current.onBusy(busy);
    };
    const touch = (direction: "input" | "output") => {
      activityRevisionRef.current++;
      if (direction === "input") lastInputAt = Date.now();
      else lastOutputAt = Date.now();
      emitBusy();
      window.clearTimeout(busyTimer);
      busyTimer = window.setTimeout(emitBusy, 1400);
    };
    touchInputRef.current = () => touch("input");
    sessionCleanupRef.current = () => {
      window.clearTimeout(busyTimer);
      window.clearTimeout(paintTimer);
      selectionObserver.disconnect();
      document.removeEventListener("selectionchange", scheduleSelectionPaint);
      term.element.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", scheduleSelectionPaint);
      dragLayer.removeEventListener("dragstart", onDragStart);
      dragLayer.removeEventListener("dragend", onDragEnd);
      dragLayer.removeEventListener("pointerdown", onSelectionPointerDown);
      window.removeEventListener("pointerup", onSelectionPointerUp);
      dragLayer.removeEventListener("wheel", onWheel);
      dragLayer.removeEventListener("click", onSelectionClick);
      dragLayer.remove();
      if (dragging) setTerminalSelectionDrag(false);
      host?.classList.remove("has-selection", "is-dragging-selection");
      touchInputRef.current = () => {};
    };
    const reader: TerminalReader = {
      getBuffer: () => bufferText(term, 1200),
      getSelection: () => term.getSelectionText() ?? "",
      readText: (signal) => term.readText({ signal }),
      getViewport: () => viewportText(term),
      sessionId: () => sessionId,
      dispose,
      write: send,
      isReadyForInput: () => shellReady && connectionRef.current?.isAttached() === true,
      isBusy,
      openFind: () => {
        findRef.current.open = true;
        setFindOpen(true);
        window.setTimeout(() => findInputRef.current?.select(), 0);
      },
      paste,
      prepareCut: () => prepareWTermCut(term, sendEditing, () => activityRevisionRef.current),
      hasShellIntegration: () => integrated || sawOsc,
      selectAll: () => { term.focus(); return term.selectAll(); },
    };
    propsRef.current.onReader(reader);
    let decoder = new TextDecoder();
    const newParser = () => createOsc133OutputStream((text) => {
      term.write(text);
    }, (marker) => {
      if (!marker.inject) sawOsc = true;
      if (marker.kind === "A" && !shellReady) {
        shellReady = true;
        propsRef.current.onReadyForInput();
      }
      commandRunning = marker.kind === "C";
      if (marker.kind === "C") propsRef.current.onCommandStart();
      if (marker.kind === "D" && marker.exitCode != null) propsRef.current.onCommandExit(marker.exitCode);
      emitBusy();
    }, (marker) => {
      replayRunning = marker.kind === "C";
      if (marker.kind === "D") replayExit = marker.exitCode;
      if (marker.kind === "A" || marker.kind === "B" || marker.kind === "D") shellReady = true;
    });
    let parseOutput = newParser();
    connectionRef.current = createWTermConnection({
      cwd: propsRef.current.cwd,
      sessionId: propsRef.current.attachSessionId,
      onStatus: (status) => {
        propsRef.current.onStatus(status);
      },
      onSession: (id, cwd, hasIntegration) => {
        sessionId = id;
        integrated = hasIntegration === true;
        propsRef.current.onSessionId(id);
        if (typeof cwd === "string" && isAbsoluteCwd(cwd)) propsRef.current.onCwd(cwd);
      },
      onReplayStart: () => {
        runningBeforeReplay = commandRunning === true;
        replayRunning = null;
        replayExit = undefined;
        shellReady = !integrated;
        decoder = new TextDecoder();
        parseOutput = newParser();
        // Reset the grid and retained history before painting the peer's log tail.
        term.clearSelection();
        term.clearSearch();
        term.write("\x1bc\x1b[3J\x1b[2J\x1b[H");
      },
      onReplayEnd: () => {
        // A truncated replay can end in the middle of an OSC or UTF-8 sequence.
        decoder = new TextDecoder();
        parseOutput = newParser();
        const find = findRef.current;
        if (find.open && find.query && !find.error) search(term, find.query);
      },
      onAttached: (reattached) => {
        if (reattached) propsRef.current.onReattached(true);
        if (!integrated) shellReady = true;
        if (reattached && replayRunning !== null) {
          commandRunning = replayRunning;
          if (runningBeforeReplay && !replayRunning && replayExit != null) propsRef.current.onCommandExit(replayExit);
        }
        emitBusy();
        connectionRef.current?.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        if (shellReady) propsRef.current.onReadyForInput();
        if (propsRef.current.active && propsRef.current.autoFocus && !findRef.current.open) term.focus();
      },
      onOutput: (data, replay) => {
        if (replay) activityRevisionRef.current++;
        parseOutput(typeof data === "string" ? data : decoder.decode(data, { stream: true }), replay);
        if (!replay) touch("output");
      },
      onControl: (ctl) => {
        if (ctl.type === "exited" && typeof ctl.exitCode === "number") propsRef.current.onExitCode(ctl.exitCode);
        else if (ctl.type === "fallback") term.write(`\r\n\x1b[33m[Shell startup stalled; switched to ${ctl.to ?? "safe"} mode]\x1b[0m\r\n`);
      },
      onWarning: (message) => setInputWarning((previous) =>
        previous?.includes("may not have arrived") && !message.includes("may not have arrived")
          ? `${message} Queued input from the disconnected connection may not have arrived and was not resent.`
          : message),
      onMissing: () => setSessionUnavailable(true),
    });
  }, [dispose, paste, search, send, sendEditing]);

  const onReady = useCallback((term: WTerm) => {
    termRef.current = term;
    window.setTimeout(() => setupTerminal(term), 0);
  }, [setupTerminal]);

  useEffect(() => {
    if (!props.active || !props.autoFocus || findRef.current.open) return;
    const timer = window.setTimeout(() => {
      if (!findRef.current.open) termRef.current?.focus();
    }, 30);
    return () => window.clearTimeout(timer);
  }, [props.active, props.autoFocus]);

  useEffect(() => {
    if (!props.active) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const term = termRef.current;
      const insideHost = hostRef.current?.contains(target) ?? false;
      const terminalTarget = term?.element.contains(target) ?? false;
      const terminalSelection = term?.getSelectionText();
      // Word and line selection can deliberately blur wterm's input.
      const selectedWithoutFocus = !insideHost && !!terminalSelection && (target === document.body || target === document.documentElement);
      if (!insideHost && !selectedWithoutFocus) return;
      const selection = terminalTarget || selectedWithoutFocus ? terminalSelection : null;
      if (term && selection && isTerminalCopyShortcut(event, isAppleTerminalPlatform())) {
        event.preventDefault();
        event.stopPropagation();
        void copyTextToClipboard(selection).catch(() => setInputWarning("Couldn't copy the selection."));
      } else if (term && selection && isTerminalCutShortcut(event, isAppleTerminalPlatform())) {
        event.preventDefault();
        event.stopPropagation();
        const cut = prepareWTermCut(term, sendEditing, () => activityRevisionRef.current);
        void copyTextToClipboard(selection).then(() => {
          cut();
          if (selectedWithoutFocus) term.focus();
        }).catch(() => setInputWarning("Couldn't copy the selection."));
      } else if (term && selection && (event.key === "Backspace" || event.key === "Delete") && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        prepareWTermCut(term, sendEditing, () => activityRevisionRef.current)();
        if (selectedWithoutFocus) term.focus();
      } else if (term && selection && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        term.clearSelection();
        if (selectedWithoutFocus) term.focus();
      } else if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        event.stopPropagation();
        findRef.current.open = true;
        setFindOpen(true);
        if (!findOpen && findQuery && !findError) termRef.current?.search(findQuery);
        window.setTimeout(() => findInputRef.current?.select(), 0);
      } else if (isTerminalShiftPasteShortcut(event, isAppleTerminalPlatform()) && termRef.current?.element.contains(target)) {
        event.preventDefault();
        event.stopPropagation();
        void readTextFromClipboard().then(paste).catch(() => setInputWarning("Couldn't read the clipboard."));
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [props.active, paste, sendEditing, findOpen, findQuery, findError]);

  const closeFind = () => {
    findRef.current.open = false;
    setFindOpen(false);
    termRef.current?.clearSearch();
    termRef.current?.focus();
  };

  const changeFind = (query: string) => {
    setFindQuery(query);
    const term = termRef.current;
    if (!term) return;
    search(term, query);
  };

  const linkForEvent = (event: React.MouseEvent<HTMLDivElement>) => {
    const term = termRef.current;
    if (!term || !(event.target instanceof Element) || !term.element.contains(event.target)) return null;
    const anchor = event.target.closest<HTMLAnchorElement>("a.term-link");
    if (anchor) return anchor.href;
    return plainLinkAt(term, event.target, event.clientX);
  };

  const isLinkGesture = (event: React.MouseEvent<HTMLDivElement>) =>
    event.button === 0 && (isAppleTerminalPlatform() ? event.metaKey : event.ctrlKey);

  if (sessionUnavailable) {
    return <div className="terminal-wterm-error" role="alert">
      <p>Could not reattach to the terminal session. It may have expired; any input in flight has uncertain delivery.</p>
      <button type="button" className="btn btn-ghost" onClick={props.onOpenNew}>Open a new terminal tab</button>
    </div>;
  }
  if (error) {
    return <div className="terminal-wterm-error" role="alert">
      <p>Terminal could not start: {error}</p>
      <button type="button" className="btn btn-ghost" onClick={props.onOpenNew}>Open a new terminal tab</button>
    </div>;
  }
  if (!core) return <div className="terminal-wterm-loading skeleton" aria-label="Loading terminal" />;

  return <div
    ref={hostRef}
    className="terminal-host terminal-wterm-wrap"
    onPasteCapture={onPasteCapture}
    onDragOver={onDragOverImages}
    onDrop={onDropImages}
    onMouseMoveCapture={(event) => {
      event.currentTarget.style.cursor = isLinkGesture(event) && linkForEvent(event) ? "pointer" : "";
    }}
    onMouseLeave={(event) => { event.currentTarget.style.cursor = ""; }}
    onMouseDownCapture={(event) => {
      if (event.button === 2 && event.target instanceof Element && event.target.closest(".terminal-sel-drag")) {
        event.preventDefault();
      }
      if (event.button === 1 && termRef.current?.element.contains(event.target as Node)) {
        event.preventDefault();
        void readTextFromClipboard().then(paste).catch(() => setInputWarning("Couldn't read the clipboard."));
        return;
      }
      if (isLinkGesture(event) && linkForEvent(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }}
    onClickCapture={(event) => {
      const keyboardLink = event.detail === 0 && event.target instanceof Element && !!event.target.closest("a.term-link");
      if (!isLinkGesture(event) && !keyboardLink) return;
      const link = linkForEvent(event);
      if (!link) return;
      event.preventDefault();
      event.stopPropagation();
      void openInBrowser(link).catch(() => setInputWarning("Couldn't open the link in your browser."));
    }}
  >
    {inputWarning && <div className="terminal-wterm-warning" role="status">
      {inputWarning} <button type="button" onClick={() => setInputWarning(null)} aria-label="Dismiss terminal warning">×</button>
    </div>}
    {findOpen && <div className="terminal-find-bar focus-host" role="search" aria-label="Find in terminal">
      <input
        ref={findInputRef}
        className="terminal-find-input"
        value={findQuery}
        placeholder="Find in output"
        aria-label="Find in terminal output"
        onChange={(event) => changeFind(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) termRef.current?.findPrevious();
            else termRef.current?.findNext();
          } else if (event.key === "Escape") {
            event.stopPropagation();
            closeFind();
          }
        }}
      />
      <span className="terminal-find-status" role="status">
        {findError ?? (findQuery && searchState ? `${searchState.searching ? "Searching · " : ""}${searchState.activeIndex >= 0 ? searchState.activeIndex + 1 : 0}/${searchState.count}${searchState.limited ? "+ · Narrow search" : ""}` : "")}
      </span>
      <button type="button" className="terminal-find-btn" aria-label="Previous match" onClick={() => termRef.current?.findPrevious()}><ChevronUp size={12} aria-hidden /></button>
      <button type="button" className="terminal-find-btn" aria-label="Next match" onClick={() => termRef.current?.findNext()}><ChevronDown size={12} aria-hidden /></button>
      <button type="button" className="terminal-find-btn" aria-label="Close find" onClick={closeFind}><X size={12} aria-hidden /></button>
    </div>}
    <Terminal
      className="terminal-wterm"
      style={{ "--term-font-size": `${props.fontSize}px` } as React.CSSProperties}
      aria-label="Terminal"
      onKeyDownCapture={() => propsRef.current.onUserInput()}
      onInputCapture={() => propsRef.current.onUserInput()}
      onPasteCapture={() => propsRef.current.onUserInput()}
      core={core}
      autoResize
      renderingPaused={!props.active}
      onReady={onReady}
      onError={(cause) => {
        setError(cause instanceof Error ? cause.message : "Could not initialise the terminal engine.");
        propsRef.current.onStatus("closed");
      }}
      onData={(data) => { send(data); }}
      onBinary={(data) => {
        if (data.length !== 6) {
          setInputWarning("Unsupported binary terminal input was not sent.");
          return;
        }
        const frame = new Uint8Array(10);
        frame.set([0x57, 0x54, 0x42, 1]);
        frame.set(data, 4);
        send(frame);
      }}
      onResize={(cols, rows) => {
        if (connectionRef.current?.isAttached()) connectionRef.current.send(JSON.stringify({ type: "resize", cols, rows }));
      }}
    />
  </div>;
}
