"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bell,
  BellOff,
  Check,
  ChevronDown,
  ClipboardCopy,
  ClipboardPaste,
  FileText,
  History,
  ListTree,
  Plus,
  RotateCw,
  Scissors,
  Sparkles,
  SquareTerminal,
  TerminalSquare,
  X,
} from "lucide-react";
import { HoverTip } from "@/components/ui/HoverTip";
import { AgentStatusStrip } from "@/components/shell/AgentStatusStrip";
import { AgentChatPanel, type AgentChatSeed } from "@/components/shell/AgentChatPanel";
import { TerminalBlockHistory } from "@/components/shell/TerminalBlockHistory";
import { TerminalBlocksView } from "@/components/shell/TerminalBlocksView";
import { TerminalProposeBar } from "@/components/shell/TerminalProposeBar";
import {
  ContextMenu,
  useContextMenu,
  type ContextMenuGroup,
} from "@/components/shell/ContextMenu";
import { type AgentUiPhase } from "@/lib/agent-status";
import {
  AGENT_CHAT_CLEAR_EVENT,
  AGENT_CHAT_EVENT,
  injectKindForPropose,
  insertAgentComposer,
  openAgentChat,
  readAgentPopoutSize,
  sendAgentChat,
  isUserAbortedAsk,
  writeAgentPopoutSize,
  type AgentChatOpenDetail,
} from "@/lib/agent-chat";
import { copyTextToClipboard, readTextFromClipboard } from "@/lib/clipboard";
import { resolveTerminalCopyText } from "@/lib/terminal-clipboard";
import { TerminalPromptBar } from "@/components/shell/TerminalPromptBar";
import { TerminalAskCard, type TerminalAskState } from "@/components/shell/TerminalAskCard";
import { useToast } from "@/lib/hooks/use-toast";
import {
  clampDockHeight,
  findTabForOpen,
  readAlwaysExpandPref,
  clampPopoutPos,
  readDockHeight,
  readPersistedDockState,
  readPopoutPos,
  shouldExpandOnTerminalOpen,
  shouldFallBackToRawView,
  shouldNotifyCommandFinished,
  writeDockHeight,
  writePersistedDockState,
  writePopoutPos,
  type PopoutPos,
  type DockFrame,
} from "@/lib/terminal-dock-state";
import { DockFrameControls } from "@/components/shell/DockFrameControls";
import { clampSize, startDragResize } from "@/lib/drag-resize";
import { ResizeHandle } from "@/components/shell/ResizeHandle";
import {
  TERMINAL_FOCUS_EVENT,
  TERMINAL_PROPOSE_EVENT,
  formatTerminalInjectPayload,
  isDestructiveTerminalCommand,
  proposeTerminalRun,
  type TerminalFocusDetail,
  type TerminalProposeDetail,
} from "@/lib/terminal-inject";
import {
  TERMINAL_TAB_TEMPLATES,
  formatTerminalTabLabel,
  isAgentLikeKind,
  type TerminalSessionKind,
} from "@/lib/terminal-meta";
import { openInteractiveAgentSession } from "@/lib/agent-job";
import { lastTerminalBlock, saveTerminalCaptureNote } from "@/lib/terminal-capture";
import { extractShellCommand, previewPromptCommand, PROMPT_ASK_SYSTEM } from "@/lib/terminal-prompt";
import {
  capBlockOutput,
  dataTransferHasTerminalSelection,
  formatBlockForAgent,
  lastNonEmptyLine,
  looksLikeInputPrompt,
  newTerminalBlockId,
  readTerminalSelection,
  setTerminalSelectionDrag,
  sliceNewOutput,
  stripCommandEcho,
  terminalBufferMarker,
  type TerminalBlockSource,
  type TerminalCommandBlock,
} from "@/lib/terminal-blocks";
import {
  recordTerminalCommand,
  readTerminalHistory,
} from "@/lib/terminal-history";
import {
  TERMINAL_FONT_SIZE_DEFAULT,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  readTerminalFontSize,
  writeTerminalFontSize,
  type Status,
  type TerminalReader,
  TerminalSession,
} from "@/components/shell/TerminalSession";
import "./terminal-agent.css";

/** Starting size for a freshly popped-out window, before the user resizes it. */
const POPOUT_DEFAULT = { w: 720, h: 520 };

/** View mode for shell sessions — Warp-style DOM blocks or the raw grid. */
type TerminalViewMode = "blocks" | "raw";
const VIEW_MODE_KEY = "devhub:terminal-view";

function readViewMode(): TerminalViewMode {
  if (typeof window === "undefined") return "blocks";
  return window.localStorage.getItem(VIEW_MODE_KEY) === "raw" ? "raw" : "blocks";
}

function writeViewMode(mode: TerminalViewMode): void {
  try {
    window.localStorage.setItem(VIEW_MODE_KEY, mode);
  } catch {
    /* private mode */
  }
}

const NOTIFY_PREF_KEY = "devhub:terminal-notify";
const RAIL_PREF_KEY = "devhub:terminal-rail-hidden";


interface DockTab {
  id: number;
  cwd?: string;
  command?: string;
  label: string;
  status: Status;
  /** Bump to tear the session down and rebuild (restart button). */
  generation: number;
  sessionId?: string | null;
  kind?: TerminalSessionKind;
  repoName?: string;
  busy?: boolean;
  lastExitCode?: number | null;
  reattached?: boolean;
  /** Last inject mode — interactive agent TUIs are not reused. */
  lastMode?: "oneshot" | "interactive";
  /** Product status strip for agent/review tabs. */
  agentPhase?: AgentUiPhase;
  agentSummary?: string;
  agentProvider?: string;
  chatSeed?: AgentChatSeed;
}

interface OpenDetail {
  cwd?: string;
  label?: string;
  command?: string;
  kind?: TerminalSessionKind;
  repoName?: string;
  preferAgentTab?: boolean;
  mode?: "oneshot" | "interactive";
  summary?: string;
  providerLabel?: string;
  agentPhase?: AgentUiPhase;
  forceNewTab?: boolean;
  chatSeed?: AgentChatSeed;
}

interface PendingInject {
  command: string;
  proposalId?: string;
  /** True when the proposal came from the server store (MCP/API). */
  serverTracked?: boolean;
  /** Hide inject echo (agent oneshots) — stty -echo then clear. */
  quiet?: boolean;
  mode?: "oneshot" | "interactive";
}

interface TerminalSummary {
  activeCount: number;
  totalCount: number;
  unread: boolean;
}

let latestTerminalSummary: TerminalSummary = { activeCount: 0, totalCount: 0, unread: false };

function syncSessionRegistry(tab: DockTab, remove = false): void {
  void fetch("/api/terminal/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      remove
        ? { tabId: tab.id, remove: true }
        : {
            tabId: tab.id,
            sessionId: tab.sessionId ?? null,
            label: tab.label,
            cwd: tab.cwd,
            kind: tab.kind,
            repoName: tab.repoName,
            status: tab.status,
            busy: tab.busy === true,
          },
    ),
  }).catch(() => {
    /* registry is best-effort for MCP */
  });
}

/**
 * Global terminal drawer — toggled from anywhere (⌃` or the top-bar button),
 * any number of tabs, sessions persist across route changes and while the
 * dock is hidden. Repos rows open tabs cwd'd at the repo via
 * `devhub:terminal-open`.
 *
 * Tab metadata + PTY session ids are also written to sessionStorage so a
 * dashboard remount can reattach to live shells (as long as the PTY peer
 * itself did not restart).
 */
export function TerminalDock() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [tabs, setTabs] = useState<DockTab[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [unread, setUnread] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const idRef = useRef(0);
  /** User hid the dock — suppress auto-expand until they open it again. */
  const userCollapsedRef = useRef(false);
  /** Per-session output readers, keyed by tab id. */
  const readersRef = useRef(new Map<number, TerminalReader>());
  /** Per-tab prompt editor element — blocks-pane clicks refocus it so typed keys land in the editor. */
  const promptInputsRef = useRef(new Map<number, HTMLTextAreaElement | null>());
  /** Commands waiting for a reattached/reused tab's reader to come online. */
  const pendingInjectRef = useRef(new Map<number, PendingInject>());
  /** Tabs opened only to host a proposal confirm — close on deny if unused. */
  const proposalScaffoldTabsRef = useRef(new Map<string, number>());
  const openRef = useRef(false);
  const tabsRef = useRef<DockTab[]>([]);
  const commandBlocksRef = useRef<Record<number, TerminalCommandBlock[]>>({});
  const [copied, setCopied] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  /** FIFO queue — never clobber an unresolved chip with a newer MCP id. */
  const [proposalQueue, setProposalQueue] = useState<TerminalProposeDetail[]>([]);
  /** Proposal id currently waiting for a quiet shell — scoped so skipConfirm can't flip another chip. */
  const [injectQueuedId, setInjectQueuedId] = useState<string | null>(null);
  const [injectError, setInjectError] = useState<string | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const templatesWrapRef = useRef<HTMLDivElement>(null);
  const [dockFrame, setDockFrame] = useState<DockFrame>("dock");
  /** null until hydrated so SSR keeps the CSS default (42vh). */
  const [dockHeight, setDockHeight] = useState<number | null>(null);
  const dockHeightRef = useRef<number | null>(null);
  const [resizing, setResizing] = useState(false);
  const [movingPopout, setMovingPopout] = useState(false);
  /** Popout dimensions live in state so an edge drag re-renders immediately. */
  const [popoutSize, setPopoutSize] = useState<{ w: number; h: number } | null>(null);
  /** Where the floating window sits; null keeps it in the default corner. */
  const [popoutPos, setPopoutPos] = useState<PopoutPos | null>(null);
  const [lastCommands, setLastCommands] = useState<Record<number, string>>({});
  const [commandBlocks, setCommandBlocks] = useState<Record<number, TerminalCommandBlock[]>>({});
  /** Tabs whose launched `command` already has its block created (once per tab). */
  const launchedBlockTabsRef = useRef(new Set<number>());
  /** Tab id → prompt line, when the running command looks blocked on stdin. */
  const [inputWaiting, setInputWaiting] = useState<Record<number, string>>({});
  const [agentDropTabId, setAgentDropTabId] = useState<number | null>(null);
  const blockMarkersRef = useRef(new Map<string, string>());
  const [askingTabId, setAskingTabId] = useState<number | null>(null);
  /** Per-tab ask lifecycle — echoes the question, then progress or the answer. */
  const [askStates, setAskStates] = useState<Record<number, TerminalAskState>>({});
  const askAbortRef = useRef<AbortController | null>(null);
  const termMenu = useContextMenu<number>();
  /**
   * Restart is a two-step action: first click arms, second click confirms.
   * We track the armed tab by id (not a boolean) so switching tabs implicitly
   * disarms it — no effect needed.
   */
  const [armedRestartId, setArmedRestartId] = useState<number | null>(null);
  const restartTimerRef = useRef<number | undefined>(undefined);
  /** null until hydrated so SSR renders the default size. */
  const [fontSize, setFontSize] = useState<number | null>(null);
  const [terminalHistory, setTerminalHistory] = useState<string[]>([]);
  /** In-progress command line typed in xterm, mirrored into the prompt editor. */
  const [liveLines, setLiveLines] = useState<Record<number, string>>({});
  const [viewMode, setViewMode] = useState<TerminalViewMode>("blocks");
  /** Tabs whose xterm is in the alternate buffer (vim/htop) — force raw. */
  const [altBufferTabs, setAltBufferTabs] = useState<Record<number, boolean>>({});
  /** OS notification when a long command finishes hidden. */
  const [notifyDone, setNotifyDone] = useState(false);
  /** Command-history rail dismissed in raw view. Remembered across sessions. */
  const [railHidden, setRailHidden] = useState(false);
  /** When each tab went busy — duration source for the notification. */
  const busySinceRef = useRef(new Map<number, number>());
  const proposal = proposalQueue[0] ?? null;

  const patchServerProposal = useCallback(
    (
      detail: { id?: string; source?: TerminalProposeDetail["source"] },
      action: "approve" | "deny" | "injected" | "failed",
      opts?: { finalCommand?: string; error?: string },
    ) => {
      // Client-side agent-job ids are not in the server store — skip to avoid 404 noise.
      if (detail.source === "agent-job") return;
      if (!detail.id) return;
      if (detail.source !== "mcp" && detail.source !== "ui") return;
      void fetch("/api/terminal/propose", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: detail.id,
          action,
          finalCommand: opts?.finalCommand,
          error: opts?.error,
        }),
      });
    },
    [],
  );

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  // Mirror for key handlers that must not re-bind on every tab switch.
  const activeIdRef = useRef<number | null>(null);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    commandBlocksRef.current = commandBlocks;
  }, [commandBlocks]);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    const saved = readPersistedDockState();
    if (saved) {
      idRef.current = saved.nextId;
      userCollapsedRef.current = saved.userCollapsed;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- rehydrating tabs from sessionStorage on mount
      setTabs(
        saved.tabs.map((tab) => ({
          id: tab.id,
          cwd: tab.cwd,
          label: tab.label,
          sessionId: tab.sessionId,
          kind: tab.kind,
          repoName: tab.repoName,
          status: (tab.kind === "agent" || tab.kind === "review" ? "open" : "connecting") as Status,
          generation: 0,
          ...(tab.kind === "agent" || tab.kind === "review"
            ? { agentPhase: "ready" as AgentUiPhase }
            : {}),
        })),
      );
      setActiveId(saved.activeId);
      setOpen(saved.open);
      openRef.current = saved.open;
      setUnread(false);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writePersistedDockState({
      tabs: tabs.map((tab) => ({
        id: tab.id,
        cwd: tab.cwd,
        label: tab.label,
        sessionId: tab.sessionId ?? null,
        kind: tab.kind,
        repoName: tab.repoName,
      })),
      activeId,
      nextId: idRef.current,
      open,
      userCollapsed: userCollapsedRef.current,
    });
  }, [tabs, activeId, open, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    for (const tab of tabs) syncSessionRegistry(tab);
  }, [tabs, hydrated]);

  // Keep idle shells visible to MCP terminal_list — don't rely only on churn.
  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setInterval(() => {
      for (const tab of tabsRef.current) syncSessionRegistry(tab);
    }, 120_000);
    return () => window.clearInterval(timer);
  }, [hydrated]);

  useEffect(() => {
    const clearDrop = () => {
      setAgentDropTabId(null);
      setTerminalSelectionDrag(false);
    };
    document.addEventListener("dragend", clearDrop);
    return () => document.removeEventListener("dragend", clearDrop);
  }, []);

  useEffect(() => {
    if (!templatesOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (templatesWrapRef.current?.contains(e.target as Node)) return;
      setTemplatesOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTemplatesOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [templatesOpen]);

  // Restore the saved dock height once on the client. Read in an effect rather
  // than a lazy initialiser so SSR keeps the CSS default and hydration matches.
  useEffect(() => {
    const saved = readDockHeight();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading synchronously from localStorage on mount
    if (saved != null) setDockHeight(saved);
    const savedPopout = readAgentPopoutSize();
    if (savedPopout) setPopoutSize(savedPopout);
    const savedPos = readPopoutPos();
    if (savedPos) setPopoutPos(savedPos);
  }, []);

  useEffect(() => {
    dockHeightRef.current = dockHeight;
  }, [dockHeight]);

  // Client-only prefs: font size, command history, view mode, notify opt-in.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- localStorage hydration on mount, same pattern as dock height */
    setFontSize(readTerminalFontSize());
    setTerminalHistory(readTerminalHistory());
    setViewMode(readViewMode());
    try {
      setNotifyDone(window.localStorage.getItem(NOTIFY_PREF_KEY) === "1");
      setRailHidden(window.localStorage.getItem(RAIL_PREF_KEY) === "1");
    } catch {
      /* private mode */
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const zoomFont = useCallback((delta: number) => {
    setFontSize((prev) => {
      const base = prev ?? TERMINAL_FONT_SIZE_DEFAULT;
      const next =
        delta === 0
          ? TERMINAL_FONT_SIZE_DEFAULT
          : Math.min(TERMINAL_FONT_SIZE_MAX, Math.max(TERMINAL_FONT_SIZE_MIN, base + delta));
      writeTerminalFontSize(next);
      return next;
    });
  }, []);

  const toggleNotifyDone = useCallback(() => {
    setNotifyDone((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(NOTIFY_PREF_KEY, next ? "1" : "0");
      } catch {
        /* private mode */
      }
      if (next && typeof Notification !== "undefined" && Notification.permission === "default") {
        void Notification.requestPermission();
      }
      return next;
    });
  }, []);

  const setRailHiddenPref = useCallback((hidden: boolean) => {
    setRailHidden(hidden);
    try {
      window.localStorage.setItem(RAIL_PREF_KEY, hidden ? "1" : "0");
    } catch {
      /* private mode */
    }
  }, []);

  const switchViewMode = useCallback((mode: TerminalViewMode) => {
    setViewMode(mode);
    writeViewMode(mode);
    if (mode !== "blocks") {
      // Raw view renders no waiting-hint chips — drop stale ones now.
      inputWaitingRef.current = {};
      setInputWaiting((prev) => (Object.keys(prev).length > 0 ? {} : prev));
    }
  }, []);

  /** Mirror of inputWaiting for the tick (carries values for skipped tabs). */
  const inputWaitingRef = useRef<Record<number, string>>({});
  /** Last processed `${activityAt}:${busy}` per tab — untouched tabs are skipped. */
  const tickSeenRef = useRef(new Map<number, string>());

  // Blocks view can't stream a long-running foreground process; the rules for
  // telling one from a slow shell live in shouldFallBackToRawView. The same
  // tick keeps pending blocks' output fresh (an interactive script's menu must
  // be visible without switching to raw) and flags "waiting for input".
  // It only runs while the dock is open in blocks view, and it skips tabs with
  // no new PTY activity — constant full-scrollback reads caused visible jank.
  useEffect(() => {
    if (viewMode !== "blocks" || !open) return;
    const tick = () => {
      const now = Date.now();
      const waiting: Record<number, string> = {};
      for (const [tabIdKey, list] of Object.entries(commandBlocksRef.current)) {
        const tabId = Number(tabIdKey);
        const reader = readersRef.current.get(tabId);
        const pending = (list ?? []).filter((b) => b.pending);
        if (reader && pending.length > 0) {
          const busy = reader.isBusy();
          const seenKey = `${reader.activityAt?.() ?? 0}:${busy}`;
          if (tickSeenRef.current.get(tabId) === seenKey) {
            const prevHint = inputWaitingRef.current[tabId];
            if (prevHint) waiting[tabId] = prevHint;
            continue;
          }
          tickSeenRef.current.set(tabId, seenKey);
          const buffer = reader.getBufferTail?.(600) ?? reader.getBuffer();
          setCommandBlocks((prev) => {
            const cur = prev[tabId];
            if (!cur) return prev;
            let changed = false;
            const next = cur.map((b) => {
              if (!b.pending) return b;
              const marker = blockMarkersRef.current.get(b.id) ?? "";
              const output = capBlockOutput(stripCommandEcho(b.command, sliceNewOutput(marker, buffer)));
              if (output === b.output) return b;
              changed = true;
              return { ...b, output };
            });
            return changed ? { ...prev, [tabId]: next } : prev;
          });
          if (!busy) {
            const promptBlock = pending.find(
              (b) => b.output.trim() && looksLikeInputPrompt(b.output),
            );
            if (promptBlock) waiting[tabId] = lastNonEmptyLine(promptBlock.output);
          }
        }
      }
      inputWaitingRef.current = waiting;
      setInputWaiting((prev) => {
        const prevKeys = Object.keys(prev);
        const nextKeys = Object.keys(waiting);
        if (
          prevKeys.length === nextKeys.length &&
          nextKeys.every((k) => prev[Number(k)] === waiting[Number(k)])
        ) {
          return prev;
        }
        return waiting;
      });
      for (const [tabId, list] of Object.entries(commandBlocksRef.current)) {
        if (
          shouldFallBackToRawView({
            blocks: list,
            now,
            busy: readersRef.current.get(Number(tabId))?.isBusy() === true,
          })
        ) {
          switchViewMode("raw");
          return;
        }
      }
    };
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, [viewMode, open, switchViewMode]);

  /**
   * Drag the dock's top edge. The shield keeps the drag alive over the xterm
   * canvas, and each session's ResizeObserver refits, so the shell reflows live.
   */
  const startDockResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setResizing(true);
    let next = dockHeightRef.current ?? Math.round(window.innerHeight * 0.42);
    startDragResize({
      cursor: "row-resize",
      onMove: (move) => {
        next = clampDockHeight(window.innerHeight - move.clientY, window.innerHeight);
        setDockHeight(next);
      },
      onDone: () => {
        setResizing(false);
        writeDockHeight(next);
      },
    });
  }, []);

  const expandDock = useCallback(() => {
    userCollapsedRef.current = false;
    // Sync before setState so same-tick readers (enqueue / poll) don't see a stale closed dock.
    openRef.current = true;
    setUnread(false);
    setOpen(true);
  }, []);

  const collapseDock = useCallback(() => {
    userCollapsedRef.current = true;
    openRef.current = false;
    setOpen(false);
    if (proposalQueue.length > 0) setUnread(true);
  }, [proposalQueue.length]);

  const completeCommandBlocks = useCallback((tabId: number, exitCode?: number) => {
    const reader = readersRef.current.get(tabId);
    const after = reader?.getBuffer() ?? "";
    lastBeginRef.current.delete(tabId);
    setCommandBlocks((prev) => {
      const list = prev[tabId];
      if (!list?.some((b) => b.pending)) return prev;
      return {
        ...prev,
        [tabId]: list.map((b) => {
          if (!b.pending) return b;
          const marker = blockMarkersRef.current.get(b.id) ?? "";
          blockMarkersRef.current.delete(b.id);
          const raw = sliceNewOutput(marker, after);
          const output = capBlockOutput(stripCommandEcho(b.command, raw));
          return {
            ...b,
            pending: false,
            output,
            endedAt: Date.now(),
            ...(exitCode != null ? { exitCode } : {}),
          };
        }),
      };
    });
  }, []);

  /**
   * Last block begun per tab — dedupes the multiple detection sources
   * (prompt-bar submit, typed-Enter, OSC 133 C) that all fire for ONE
   * execution. Cleared on completion so a genuine rerun creates a new block.
   */
  const lastBeginRef = useRef(new Map<number, { cmd: string; at: number }>());

  const beginCommandBlock = useCallback(
    (tabId: number, command: string, source: TerminalBlockSource) => {
      const cmd = command.trim();
      if (!cmd) return;
      // When shell integration is live, OSC 133 owns block creation — the
      // prompt-bar/typed heuristics only double-fire for the same execution.
      if (source !== "osc" && readersRef.current.get(tabId)?.hasShellIntegration?.()) {
        return;
      }
      const existing = commandBlocksRef.current[tabId];
      const last = existing?.[existing.length - 1];
      if (last?.pending && last.command === cmd && Date.now() - last.startedAt < 2_000) {
        return;
      }
      // Flush stragglers BEFORE touching the dedupe marker — completion
      // clears it, so setting the marker first would throw it away.
      completeCommandBlocks(tabId);
      // Slow shells buffer input for seconds before executing it, so the OSC C
      // detection can lag the prompt-bar one well past 2s — dedupe on the
      // last begun command regardless of pending state.
      const lastBegin = lastBeginRef.current.get(tabId);
      if (lastBegin && lastBegin.cmd === cmd && Date.now() - lastBegin.at < 15_000) {
        return;
      }
      lastBeginRef.current.set(tabId, { cmd, at: Date.now() });
      // Typed-in-xterm and OSC paths used to skip the prompt-bar history store
      // — ↑/⌃R then only saw Run-button commands. Same list, every source.
      setTerminalHistory((prev) => recordTerminalCommand(prev, cmd));
      setLiveLines((prev) => (prev[tabId] ? { ...prev, [tabId]: "" } : prev));
      const id = newTerminalBlockId();
      const reader = readersRef.current.get(tabId);
      blockMarkersRef.current.set(id, terminalBufferMarker(reader?.getBuffer() ?? ""));
      const startLine = reader?.cursorLine?.() ?? 0;
      setLastCommands((prev) => ({ ...prev, [tabId]: cmd }));
      setCommandBlocks((prev) => {
        const next = [
          ...(prev[tabId] ?? []),
          {
            id,
            command: cmd,
            output: "",
            startedAt: Date.now(),
            source,
            pending: true,
            startLine,
          },
        ].slice(-40);
        return { ...prev, [tabId]: next };
      });
    },
    [completeCommandBlocks],
  );

  /** Tabs with a flush loop already running — onReader + setStatus both call
   * flush on session open; two loops would write the command twice. */
  const flushingInjectRef = useRef(new Set<number>());

  const flushPendingInject = useCallback(
    (tabId: number) => {
      const pending = pendingInjectRef.current.get(tabId);
      if (!pending) return;
      if (flushingInjectRef.current.has(tabId)) return;
      flushingInjectRef.current.add(tabId);
      const reader = readersRef.current.get(tabId);
      if (!reader) {
        flushingInjectRef.current.delete(tabId);
        return;
      }

      const fail = (message: string) => {
        flushingInjectRef.current.delete(tabId);
        pendingInjectRef.current.delete(tabId);
        setInjectQueuedId(null);
        setInjectError(message);
        toast.error(message);
        setTabs((prev) =>
          prev.map((t) =>
            t.id === tabId && isAgentLikeKind(t.kind)
              ? { ...t, agentPhase: "failed" as AgentUiPhase, agentSummary: message }
              : t,
          ),
        );
        if (pending.proposalId && pending.serverTracked) {
          void fetch("/api/terminal/propose", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: pending.proposalId,
              action: "failed",
              finalCommand: pending.command,
              error: message,
            }),
          });
        }
      };

      const succeed = () => {
        flushingInjectRef.current.delete(tabId);
        pendingInjectRef.current.delete(tabId);
        setInjectQueuedId(null);
        setInjectError(null);
        if (pending.proposalId && pending.serverTracked) {
          void fetch("/api/terminal/propose", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: pending.proposalId,
              action: "injected",
              finalCommand: pending.command,
            }),
          });
        }
        if (pending.proposalId) {
          const id = pending.proposalId;
          setProposalQueue((prev) => {
            if (prev[0]?.id === id) return prev.slice(1);
            return prev.filter((p) => p.id !== id);
          });
        }
        // Advance agent chrome: interactive → ready shortly; oneshot stays running until idle.
        setTabs((prev) =>
          prev.map((t) => {
            if (t.id !== tabId || !isAgentLikeKind(t.kind)) return t;
            if (t.lastMode === "interactive") {
              window.setTimeout(() => {
                setTabs((cur) =>
                  cur.map((x) =>
                    x.id === tabId && x.agentPhase === "starting"
                      ? { ...x, agentPhase: "ready" as AgentUiPhase }
                      : x,
                  ),
                );
              }, 900);
              return { ...t, agentPhase: "starting" as AgentUiPhase };
            }
            return { ...t, agentPhase: "running" as AgentUiPhase };
          }),
        );
      };

      const wait = (attempt: number) => {
        // Still queued in the map until write or fail — visible chip stays up.
        if (!pendingInjectRef.current.has(tabId)) return;
        if (attempt > 240) {
          // ~60s at 250ms — fail loudly rather than silent drop, and say
          // what is actually hogging the shell.
          const pendingBlocks = (commandBlocksRef.current[tabId] ?? []).filter((b) => b.pending);
          const running = pendingBlocks[pendingBlocks.length - 1]?.command;
          fail(
            running
              ? `Terminal is still running \`${previewPromptCommand(running, 60)}\` — command was not injected. Stop it or retry when idle.`
              : "Terminal stayed busy — command was not injected. Deny or retry when idle.",
          );
          return;
        }
        if (reader.isBusy()) {
          if (pending.proposalId) setInjectQueuedId(pending.proposalId);
          window.setTimeout(() => wait(attempt + 1), 250);
          return;
        }
        const writeQuiet = () => {
          // Hide argv flash: echo off → clear+command → echo on.
          beginCommandBlock(tabId, pending.command, "inject");
          if (!reader.write("stty -echo\r")) {
            fail("Could not write to the terminal session.");
            return;
          }
          window.setTimeout(() => {
            if (!pendingInjectRef.current.has(tabId)) return;
            const payload = formatTerminalInjectPayload(
              `printf '\\033[2J\\033[H'; ${pending.command}; stty echo 2>/dev/null || true`,
            );
            if (!reader.write(payload)) {
              fail("Could not write to the terminal session.");
              return;
            }
            succeed();
          }, 60);
        };

        const tab = tabsRef.current.find((t) => t.id === tabId);
        const interactive = pending.mode === "interactive" || tab?.lastMode === "interactive";
        // Interactive TUIs own the tty — stty -echo fights their raw mode.
        // Status strip + hidden PTY cover the brief command echo.
        if (pending.quiet && !interactive) {
          writeQuiet();
          return;
        }
        if (!interactive) beginCommandBlock(tabId, pending.command, "inject");
        const payload = formatTerminalInjectPayload(pending.command);
        if (!reader.write(payload)) {
          fail("Could not write to the terminal session.");
          return;
        }
        succeed();
      };
      // Give a fresh session a beat to settle before typing.
      if (pending.proposalId) setInjectQueuedId(pending.proposalId);
      window.setTimeout(() => wait(0), 200);
    },
    [beginCommandBlock, toast],
  );

  const addTab = useCallback(
    (detail?: OpenDetail & { pendingProposalId?: string; serverTracked?: boolean }) => {
      const preferAgent =
        detail?.preferAgentTab === true ||
        (detail?.preferAgentTab !== false && isAgentLikeKind(detail?.kind));

      const reuse =
        detail?.forceNewTab || detail?.agentPhase === "failed"
          ? null
          : findTabForOpen(tabsRef.current, {
        cwd: detail?.cwd,
        label: detail?.label,
        command: detail?.command,
        kind: detail?.kind,
        repoName: detail?.repoName,
        preferAgentTab: detail?.preferAgentTab,
        mode: detail?.mode,
      });

      if (reuse) {
        setActiveId(reuse.id);
        if (detail?.mode || detail?.agentPhase || detail?.summary || detail?.providerLabel || detail?.chatSeed) {
          setTabs((prev) =>
            prev.map((t) =>
              t.id === reuse.id
                ? {
                    ...t,
                    ...(detail?.mode ? { lastMode: detail.mode } : {}),
                    ...(detail?.agentPhase ? { agentPhase: detail.agentPhase } : {}),
                    ...(detail?.summary ? { agentSummary: detail.summary } : {}),
                    ...(detail?.providerLabel ? { agentProvider: detail.providerLabel } : {}),
                    ...(detail?.chatSeed ? { chatSeed: detail.chatSeed } : {}),
                  }
                : t,
            ),
          );
        }
        if (
          shouldExpandOnTerminalOpen({
            userCollapsed: userCollapsedRef.current,
            alwaysExpand: readAlwaysExpandPref(),
          })
        ) {
          expandDock();
        } else {
          setUnread(true);
        }
        if (detail?.command && !isAgentLikeKind(detail.kind ?? reuse.kind)) {
          pendingInjectRef.current.set(reuse.id, {
            command: detail.command,
            proposalId: detail.pendingProposalId,
            serverTracked: detail.serverTracked,
            quiet: false,
            mode: detail.mode,
          });
          flushPendingInject(reuse.id);
        }
        return { id: reuse.id, created: false };
      }

      // Prefer-agent opens without a command still must not land on a
      // dedicated tab by cwd — findTabForOpen already enforces that.

      const id = ++idRef.current;
      const kind = detail?.kind ?? (preferAgent ? "agent" : "shell");
      const label = formatTerminalTabLabel({
        label: detail?.label,
        kind,
        repoName: detail?.repoName,
        cwd: detail?.cwd,
      });
      const agentLike = isAgentLikeKind(kind);
      setTabs((prev) => [
        ...prev,
        {
          id,
          cwd: detail?.cwd,
          command: agentLike ? undefined : detail?.command,
          label,
          kind,
          repoName: detail?.repoName,
          status: agentLike || detail?.agentPhase === "failed" ? "open" : "connecting",
          generation: 0,
          lastMode: agentLike ? undefined : detail?.mode,
          ...(agentLike
            ? {
                agentPhase: detail?.agentPhase ?? (detail?.chatSeed?.autoSend ? "starting" : "ready") as AgentUiPhase,
                agentSummary: detail?.summary,
                agentProvider: detail?.providerLabel,
                chatSeed: detail?.chatSeed,
              }
            : {}),
        },
      ]);
      setActiveId(id);
      if (
        shouldExpandOnTerminalOpen({
          userCollapsed: userCollapsedRef.current,
          alwaysExpand: readAlwaysExpandPref(),
        })
      ) {
        expandDock();
      } else {
        setUnread(true);
      }
      return { id, created: true };
    },
    [expandDock, flushPendingInject],
  );

  const closeTab = useCallback((id: number) => {
    const tab = tabsRef.current.find((t) => t.id === id);
    pendingInjectRef.current.delete(id);
    tickSeenRef.current.delete(id);
    readersRef.current.get(id)?.dispose();
    readersRef.current.delete(id);
    setCommandBlocks((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (tab) syncSessionRegistry(tab, true);
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      setActiveId((curr) => (curr === id ? (next[next.length - 1]?.id ?? null) : curr));
      return next;
    });
  }, []);

  const toggle = useCallback(() => {
    setOpen((wasOpen) => {
      if (wasOpen) {
        userCollapsedRef.current = true;
        openRef.current = false;
        if (proposalQueue.length > 0) setUnread(true);
        return false;
      }
      userCollapsedRef.current = false;
      openRef.current = true;
      setUnread(false);
      setTabs((prev) => {
        if (prev.length === 0) {
          const id = ++idRef.current;
          setActiveId(id);
          return [{ id, label: "zsh", kind: "shell", status: "connecting" as Status, generation: 0 }];
        }
        return prev;
      });
      return true;
    });
  }, [proposalQueue.length]);

  const enqueueProposal = useCallback((detail: TerminalProposeDetail) => {
    setProposalQueue((prev) => {
      if (prev.some((p) => p.id === detail.id)) return prev;
      return [...prev, detail];
    });
    setInjectError(null);
    if (!openRef.current) setUnread(true);
  }, []);

  const handlePropose = useCallback(
    (detail: TerminalProposeDetail) => {
      expandDock();
      const serverTracked = detail.source === "mcp" || detail.source === "ui";
      const injectKind = injectKindForPropose({ kind: detail.kind, source: detail.source });
      if (detail.skipConfirm) {
        // Never put command on the new tab — inject via pending map after open so
        // server status tracks a real write (no optimistic "injected" PATCH).
        const result = addTab({
          cwd: detail.cwd,
          label: detail.label,
          kind: injectKind,
          repoName: detail.repoName,
          preferAgentTab: false,
          forceNewTab: detail.forceNewTab,
          mode: detail.mode,
          summary: detail.summary,
          providerLabel: detail.providerLabel,
        });
        pendingInjectRef.current.set(result.id, {
          command: detail.command,
          proposalId: detail.id,
          serverTracked,
          quiet: false,
          mode: detail.mode,
        });
        flushPendingInject(result.id);
        return;
      }
      enqueueProposal(detail);
      const beforeIds = new Set(tabsRef.current.map((t) => t.id));
      const result = addTab({
        cwd: detail.cwd,
        label: detail.label,
        kind: injectKind,
        repoName: detail.repoName,
        preferAgentTab: false,
        forceNewTab: detail.forceNewTab,
        mode: detail.mode,
        summary: detail.summary,
        providerLabel: detail.providerLabel,
      });
      if (result.created && !beforeIds.has(result.id)) {
        proposalScaffoldTabsRef.current.set(detail.id, result.id);
      }
    },
    [addTab, enqueueProposal, expandDock, flushPendingInject],
  );

  useEffect(() => {
    const onToggle = () => toggle();
    const onOpen = (e: Event) => {
      addTab((e as CustomEvent<OpenDetail>).detail);
    };
    const onAgentChat = (e: Event) => {
      const detail = (e as CustomEvent<AgentChatOpenDetail>).detail;
      // A CustomEvent is a runtime boundary — `title` is required by the type,
      // but a dispatcher that omits it used to throw here and take the whole
      // dock down rather than just ignoring one bad payload.
      if (!detail?.title?.trim()) return;
      const prompt = detail.prompt?.trim() ?? "";
      const display = (detail.display ?? detail.summary ?? detail.title).trim();
      addTab({
        cwd: detail.cwd,
        label: detail.title,
        kind: detail.kind ?? "agent",
        repoName: detail.repoName,
        preferAgentTab: true,
        summary: detail.summary,
        providerLabel: detail.providerLabel,
        agentPhase: detail.agentPhase ?? (detail.autoSend ? "starting" : "ready"),
        forceNewTab: detail.forceNewTab,
        chatSeed:
          prompt || display
            ? {
                prompt: prompt || display,
                display: display || prompt,
                autoSend: detail.autoSend === true,
                composerDraft: detail.autoSend !== true,
              }
            : undefined,
      });
    };
    const onPropose = (e: Event) => handlePropose((e as CustomEvent<TerminalProposeDetail>).detail);
    const onFocus = (e: Event) => {
      const detail = (e as CustomEvent<TerminalFocusDetail>).detail;
      addTab({
        cwd: detail.cwd,
        label: detail.label,
        kind: detail.kind,
        repoName: detail.repoName,
        command: detail.createIfMissing === false ? undefined : detail.command,
      });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "`" && e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        toggle();
        return;
      }
      // Tab management. ⌘T/⌘W are browser-reserved, so the terminal uses
      // Alt-based chords (⌥T new, ⌥⇧W close, ⌥1–9 switch). Skipped while
      // typing in a normal field — Alt+letter inserts characters there — but
      // allowed from the xterm itself (its hidden textarea is how it captures).
      const keyTarget = e.target as HTMLElement | null;
      const inEditable =
        !!keyTarget?.closest("input, textarea, [contenteditable='true'], [contenteditable='']") &&
        !keyTarget?.closest(".terminal-host");
      if (
        !inEditable &&
        e.altKey &&
        !e.metaKey &&
        !e.ctrlKey
      ) {
        if (e.key.toLowerCase() === "t" && !e.shiftKey) {
          e.preventDefault();
          addTab();
          return;
        }
        if (e.key.toLowerCase() === "w" && e.shiftKey) {
          e.preventDefault();
          const activeIdNow = activeIdRef.current;
          if (activeIdNow != null) closeTab(activeIdNow);
          return;
        }
        const digit = /^([1-9])$/.exec(e.key);
        if (digit) {
          const target = tabsRef.current[Number(digit[1]) - 1];
          if (target) {
            e.preventDefault();
            setActiveId(target.id);
            return;
          }
        }
      }
      // Font zoom — ⌘/Ctrl with +, -, or 0. Only while the dock is visible.
      if (
        openRef.current &&
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        (e.key === "+" || e.key === "=" || e.key === "-" || e.key === "0")
      ) {
        if (e.key === "0") zoomFont(0);
        else zoomFont(e.key === "-" ? -1 : 1);
        e.preventDefault();
        return;
      }
      if (e.key !== "Escape") return;
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("[role='dialog'], [data-command-palette]")) return;
      if (templatesOpen) {
        setTemplatesOpen(false);
        e.preventDefault();
        return;
      }
      if (dockFrame === "popout" || dockFrame === "split") {
        e.preventDefault();
        setDockFrame("dock");
      }
    };
    window.addEventListener("devhub:terminal-toggle", onToggle);
    window.addEventListener("devhub:terminal-open", onOpen);
    window.addEventListener(AGENT_CHAT_EVENT, onAgentChat);
    window.addEventListener(TERMINAL_PROPOSE_EVENT, onPropose);
    window.addEventListener(TERMINAL_FOCUS_EVENT, onFocus);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("devhub:terminal-toggle", onToggle);
      window.removeEventListener("devhub:terminal-open", onOpen);
      window.removeEventListener(AGENT_CHAT_EVENT, onAgentChat);
      window.removeEventListener(TERMINAL_PROPOSE_EVENT, onPropose);
      window.removeEventListener(TERMINAL_FOCUS_EVENT, onFocus);
      document.removeEventListener("keydown", onKey);
    };
  }, [toggle, addTab, handlePropose, templatesOpen, dockFrame, closeTab, zoomFont]);

  // Poll MCP/API proposals so OpenCode tools surface in the dock UI (FIFO enqueue).
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/terminal/propose?status=pending");
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          proposals?: Array<{
            id: string;
            command: string;
            cwd?: string;
            label?: string;
            summary?: string;
            kind?: TerminalSessionKind;
            repoName?: string;
            preferAgentTab?: boolean;
            reason?: string;
            source?: string;
          }>;
        };
        const pending = data.proposals ?? [];
        if (pending.length === 0 || cancelled) return;

        const mapped: TerminalProposeDetail[] = pending.map((next) => ({
          id: next.id,
          command: next.command,
          cwd: next.cwd,
          label: next.label,
          summary: next.summary,
          kind: next.kind ?? "shell",
          repoName: next.repoName,
          preferAgentTab: next.preferAgentTab !== false,
          reason: next.reason,
          source: next.source === "mcp" ? "mcp" : "ui",
        }));

        let additions: TerminalProposeDetail[] = [];
        setProposalQueue((curr) => {
          const known = new Set(curr.map((p) => p.id));
          additions = mapped.filter((p) => !known.has(p.id));
          if (additions.length === 0) return curr;
          return [...curr, ...additions];
        });

        if (cancelled || additions.length === 0) return;
        expandDock();
        if (!openRef.current) setUnread(true);
        const focus = additions[0];
        if (focus) {
          const result = addTab({
            cwd: focus.cwd,
            label: focus.label,
            kind: injectKindForPropose({ kind: focus.kind, source: focus.source }),
            repoName: focus.repoName,
            preferAgentTab: false,
          });
          if (result.created) {
            proposalScaffoldTabsRef.current.set(focus.id, result.id);
          }
        }
      } catch {
        /* ignore */
      }
    };
    void tick();
    const timer = window.setInterval(tick, 2_500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [hydrated, addTab, expandDock]);

  const setStatus = useCallback(
    (id: number, status: Status) => {
      setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));
      if (status === "open") flushPendingInject(id);
    },
    [flushPendingInject],
  );

  const setSessionId = useCallback((id: number, sessionId: string | null) => {
    setTabs((prev) =>
      prev.map((t) => {
        // Attach miss: peer spawned a fresh session — drop stale id already handled
        // by the new sessionId from the ctl frame.
        if (t.id !== id) return t;
        return { ...t, sessionId };
      }),
    );
  }, []);

  const restartTab = useCallback((id: number) => {
    readersRef.current.get(id)?.dispose();
    // A queued inject must not fire into the fresh shell — it already ran (or
    // never ran) in the old one; replaying it double-executes the command.
    pendingInjectRef.current.delete(id);
    setInjectQueuedId(null);
    setCommandBlocks((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setTabs((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              generation: t.generation + 1,
              status: "connecting",
              sessionId: null,
              command: undefined,
              lastExitCode: null,
              reattached: false,
            }
          : t,
      ),
    );
  }, []);

  const copyActive = useCallback(async () => {
    const reader = activeId != null ? readersRef.current.get(activeId) : undefined;
    if (!reader) return;
    const sid = reader.sessionId();
    let text = "";
    if (sid) {
      try {
        const res = await fetch(`/api/terminal/log?session=${encodeURIComponent(sid)}`);
        if (res.ok) text = await res.text();
      } catch {
        /* fall through to buffer */
      }
    }
    if (!text) text = reader.getBuffer();
    try {
      await copyTextToClipboard(text);
    } catch {
      // Don't claim "Copied" when nothing was copied.
      toast.error("Couldn't copy the terminal output.");
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, [activeId, toast]);

  const saveActiveToNote = useCallback(async () => {
    const tab = activeId != null ? tabsRef.current.find((t) => t.id === activeId) : undefined;
    const reader = activeId != null ? readersRef.current.get(activeId) : undefined;
    if (!tab || !reader) return;
    const selection = reader.getSelection()?.trim();
    let body = selection || "";
    if (!body) {
      const sid = reader.sessionId();
      if (sid) {
        try {
          const res = await fetch(`/api/terminal/log?session=${encodeURIComponent(sid)}`);
          if (res.ok) body = lastTerminalBlock(await res.text());
        } catch {
          /* fall through */
        }
      }
      if (!body) body = lastTerminalBlock(reader.getBuffer());
    }
    try {
      const result = await saveTerminalCaptureNote({
        label: tab.repoName || tab.label,
        cwd: tab.cwd,
        sessionId: reader.sessionId(),
        body,
      });
      setSavedNote(result.path);
      window.setTimeout(() => setSavedNote(null), 2500);
    } catch {
      setSavedNote("failed");
      window.setTimeout(() => setSavedNote(null), 2500);
    }
  }, [activeId]);

  const sendTerminalToAgent = useCallback((tab: DockTab | undefined, text: string) => {
    const body = text.replace(/\s+$/, "");
    if (!body) {
      toast.error("Nothing to send.");
      return;
    }
    openAgentChat({
      title: tab?.repoName ? `Agent · ${tab.repoName}` : "Agent",
      prompt: body,
      display: body,
      kind: "agent",
      cwd: tab?.cwd,
      repoName: tab?.repoName,
      autoSend: false,
      composerDraft: true,
    });
  }, [toast]);

  const runPromptCommand = useCallback(
    (tab: DockTab, command: string) => {
      const cmd = command.trim();
      if (!cmd) return;
      setTerminalHistory((prev) => recordTerminalCommand(prev, cmd));
      setLiveLines((prev) => (prev[tab.id] ? { ...prev, [tab.id]: "" } : prev));
      if (isDestructiveTerminalCommand(cmd)) {
        proposeTerminalRun({
          command: cmd,
          cwd: tab.cwd,
          kind: tab.kind ?? "shell",
          repoName: tab.repoName,
          preferAgentTab: false,
          summary: cmd,
          source: "ui",
        });
        return;
      }
      beginCommandBlock(tab.id, cmd, "prompt");
      const reader = readersRef.current.get(tab.id);
      if (reader?.write(formatTerminalInjectPayload(cmd))) return;
      pendingInjectRef.current.set(tab.id, { command: cmd, quiet: false });
      flushPendingInject(tab.id);
    },
    [beginCommandBlock, flushPendingInject],
  );

  const askPromptCommand = useCallback(
    async (tab: DockTab, text: string) => {
      const q = text.trim();
      if (!q) return;
      askAbortRef.current?.abort();
      const ac = new AbortController();
      askAbortRef.current = ac;
      setAskingTabId(tab.id);
      // Echo the question immediately — a submitted prompt must never vanish.
      setAskStates((prev) => ({
        ...prev,
        [tab.id]: { question: q, startedAt: Date.now(), phase: "thinking" },
      }));
      const patchAsk = (patch: Partial<TerminalAskState>) => {
        setAskStates((prev) => {
          const cur = prev[tab.id];
          if (!cur || cur.question !== q) return prev;
          return { ...prev, [tab.id]: { ...cur, ...patch } };
        });
      };
      const dropAsk = () => {
        setAskStates((prev) => {
          if (prev[tab.id]?.question !== q) return prev;
          const next = { ...prev };
          delete next[tab.id];
          return next;
        });
      };
      try {
        const result = await sendAgentChat(
          {
            messages: [
              { role: "system", content: PROMPT_ASK_SYSTEM },
              { role: "user", content: tab.cwd ? `cwd: ${tab.cwd}\n\n${q}` : q },
            ],
            cwd: tab.cwd,
          },
          undefined,
          ac.signal,
        );
        const cmd = extractShellCommand(result.text);
        if (!cmd) {
          // An explanation without a runnable command is an answer, not an error.
          const answer = result.text.trim();
          patchAsk({
            phase: answer ? "answered" : "failed",
            answer: answer || "The agent returned no command and no answer.",
            endedAt: Date.now(),
          });
          return;
        }
        // The proposal chip takes over as the visible echo (it carries the question).
        dropAsk();
        proposeTerminalRun({
          command: cmd,
          cwd: tab.cwd,
          kind: tab.kind ?? "shell",
          repoName: tab.repoName,
          preferAgentTab: false,
          summary: cmd,
          reason: q,
          source: "ui",
        });
      } catch (err) {
        if (isUserAbortedAsk(err, ac.signal)) {
          dropAsk();
          return;
        }
        const msg = err instanceof Error ? err.message : "Ask failed.";
        patchAsk({ phase: "failed", answer: msg, endedAt: Date.now() });
        toast.error(msg);
      } finally {
        if (askAbortRef.current === ac) askAbortRef.current = null;
        setAskingTabId((curr) => (curr === tab.id ? null : curr));
      }
    },
    [toast],
  );

  /** AI explain/fix for a failed block — reuses the ask → propose flow. */
  const explainFailedBlock = useCallback(
    (tab: DockTab, block: TerminalCommandBlock) => {
      const tail = block.output.split("\n").slice(-30).join("\n").slice(0, 4_000);
      const text = [
        `This command failed with exit code ${block.exitCode ?? "?"}. Explain why in one or two sentences and give the single most likely fix as a shell command.`,
        "",
        `$ ${block.command}`,
        tail ? `\n${tail}` : "",
      ].join("\n");
      void askPromptCommand(tab, text);
    },
    [askPromptCommand],
  );

  /** Jump to where a command ran: raw grid, scrolled to its start line. */
  const jumpToBlock = useCallback((tab: DockTab, block: TerminalCommandBlock) => {
    switchViewMode("raw");
    const reader = readersRef.current.get(tab.id);
    reader?.scrollToLine(block.startLine ?? 0);
  }, [switchViewMode]);

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

  useEffect(() => {
    latestTerminalSummary = {
      activeCount: tabs.filter((tab) => tab.status !== "closed").length,
      totalCount: tabs.length,
      unread,
    };
    window.dispatchEvent(
      new CustomEvent<TerminalSummary>("devhub:terminal-summary", { detail: latestTerminalSummary }),
    );
  }, [tabs, unread]);

  if (tabs.length === 0 && proposalQueue.length === 0) return null;
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const restartArmed = !!active && armedRestartId === active.id;
  const activeBusy = active?.busy === true;
  const showSessionActions = !!active && !isAgentLikeKind(active.kind);
  /** The rail shows whenever the blocks pane doesn't — mirror that exactly. */
  const railApplies = !!active && !(viewMode === "blocks" && altBufferTabs[active.id] !== true);
  const agentActive = isAgentLikeKind(active?.kind);
  const splitOn = dockFrame === "split";
  const splitAgent =
    tabs.find((t) => isAgentLikeKind(t.kind) && t.id === activeId) ??
    tabs.find((t) => isAgentLikeKind(t.kind));
  const splitShell =
    tabs.find((t) => !isAgentLikeKind(t.kind) && t.id === activeId) ??
    [...tabs].reverse().find((t) => !isAgentLikeKind(t.kind));
  // Popout detaches the whole dock as a floating window — tabs, actions and
  // all — so nothing stops working while it floats.
  const windowed = open && dockFrame === "popout";
  const frameAttr = dockFrame === "popout" || dockFrame === "dock" ? undefined : dockFrame;
  // An explicit height only applies to the normal dock frame; the floating
  // window is sized by popout state and split by CSS.
  const dockStyle: React.CSSProperties = {
    display: open ? undefined : "none",
  };
  if (dockHeight != null && !windowed) dockStyle.height = `${dockHeight}px`;
  const popoutStyle = (): React.CSSProperties => {
    const size = {
      width: popoutSize?.w ?? POPOUT_DEFAULT.w,
      height: popoutSize?.h ?? POPOUT_DEFAULT.h,
    };
    // Once dragged the window is placed from the top-left, so the CSS corner
    // anchor has to be released or `right` would fight the new `left`.
    return popoutPos
      ? { ...size, left: popoutPos.x, top: popoutPos.y, right: "auto" }
      : size;
  };
  const windowStyle: React.CSSProperties | null = windowed
    ? { ...popoutStyle(), ...(movingPopout ? { userSelect: "none" } : {}) }
    : null;
  const shellForAgent =
    (agentActive ? splitShell : active && !isAgentLikeKind(active.kind) ? active : splitShell) ?? null;
  // readersRef is a live registry filled by each session's onReader callback.
  // The Agent pane needs whatever the shell shows *now*, so this is read at
  // render time on purpose — there is no render-safe copy to read instead.
  // eslint-disable-next-line react-hooks/refs
  const shellReader = shellForAgent ? readersRef.current.get(shellForAgent.id) : undefined;
  const shellLastBlock = shellReader
    ? lastTerminalBlock(shellReader.getSelection()?.trim() || shellReader.getBuffer())
    : undefined;

  /** Drag the floating window by its title bar, like a real window. */
  const startPopoutMove = (event: React.MouseEvent) => {
    // Buttons and tab chips stay interactive; drag starts from bare bar space.
    if ((event.target as HTMLElement).closest("button, [role='tab'], .terminal-dock-new-wrap"))
      return;
    event.preventDefault();
    const win = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!win) return;
    const grabX = event.clientX - win.left;
    const grabY = event.clientY - win.top;
    const size = { w: win.width, h: win.height };
    let next: PopoutPos = { x: win.left, y: win.top };
    setMovingPopout(true);
    startDragResize({
      cursor: "grabbing",
      onMove: (move) => {
        next = clampPopoutPos(
          { x: move.clientX - grabX, y: move.clientY - grabY },
          size,
          { w: window.innerWidth, h: window.innerHeight },
        );
        setPopoutPos(next);
      },
      onDone: () => {
        setMovingPopout(false);
        writePopoutPos(next);
      },
    });
  };

  /**
   * Drag a popout edge. The window is pinned to the top-right, so the left
   * edge grows it leftwards and the bottom edge grows it down — the same
   * shield-based drag the dashboard side panels use.
   */
  const startPopoutResize = (axis: "w" | "s") => (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!rect) return;
    let next = { w: Math.round(rect.width), h: Math.round(rect.height) };
    startDragResize({
      cursor: axis === "w" ? "col-resize" : "row-resize",
      onMove: (move) => {
        next =
          axis === "w"
            ? { ...next, w: clampSize(rect.right - move.clientX, 360, window.innerWidth - 32) }
            : { ...next, h: clampSize(move.clientY - rect.top, 280, window.innerHeight - rect.top - 16) };
        setPopoutSize(next);
      },
      onDone: () => writeAgentPopoutSize(next),
    });
  };
  /** Split needs one Agent pane and one shell pane — scaffold the missing one. */
  const toggleSplit = (tab: DockTab | undefined) => {
    if (dockFrame === "split") {
      setDockFrame("dock");
      return;
    }
    if (!tabsRef.current.some((t) => !isAgentLikeKind(t.kind))) {
      addTab({ kind: "shell", cwd: tab?.cwd, repoName: tab?.repoName });
    }
    if (!tabsRef.current.some((t) => isAgentLikeKind(t.kind))) return;
    setDockFrame("split");
  };
  const menuTab = termMenu.target != null ? tabs.find((t) => t.id === termMenu.target) : undefined;
  // Same live registry — the context menu enables/disables "Copy" from the
  // selection that exists at the moment the menu renders.
  // eslint-disable-next-line react-hooks/refs
  const menuReader = termMenu.target != null ? readersRef.current.get(termMenu.target) : undefined;
  const menuSelection = resolveTerminalCopyText(
    menuReader?.getSelection(),
    typeof window !== "undefined" ? window.getSelection()?.toString() : "",
  );
  const termMenuGroups: ContextMenuGroup[] = [
    {
      id: "clip",
      items: [
        {
          id: "copy",
          label: "Copy",
          icon: <ClipboardCopy size={12} aria-hidden />,
          disabled: !menuSelection,
          disabledReason: "No selection",
          onSelect: () => {
            if (!menuSelection) return;
            void copyTextToClipboard(menuSelection);
          },
        },
        {
          id: "cut",
          label: "Cut",
          icon: <Scissors size={12} aria-hidden />,
          disabled: !menuReader?.getSelection()?.trim(),
          disabledReason: "No terminal selection",
          onSelect: () => {
            const text = menuReader?.getSelection()?.trim();
            if (!text || !menuReader) return;
            void copyTextToClipboard(text);
            menuReader.deleteSelection();
          },
        },
        {
          id: "paste",
          label: "Paste",
          icon: <ClipboardPaste size={12} aria-hidden />,
          onSelect: () => {
            void readTextFromClipboard().then((text) => {
              if (!text || !menuReader) return;
              menuReader.paste(text);
            });
          },
        },
        {
          id: "send-agent",
          label: "Send to Agent",
          icon: <Sparkles size={12} aria-hidden />,
          onSelect: () => {
            const text = menuSelection || lastTerminalBlock(menuReader?.getBuffer() ?? "");
            sendTerminalToAgent(menuTab, text);
          },
        },
        {
          id: "send-block",
          label: "Send last block",
          icon: <Sparkles size={12} aria-hidden />,
          onSelect: () => sendTerminalToAgent(menuTab, lastTerminalBlock(menuReader?.getBuffer() ?? "")),
        },
        {
          id: "send-screen",
          label: "Send screen",
          icon: <Sparkles size={12} aria-hidden />,
          onSelect: () => sendTerminalToAgent(menuTab, menuReader?.getViewport() ?? ""),
        },
      ],
    },
  ];

  return (
    <div
      className={windowed ? "terminal-dock terminal-dock-window" : "terminal-dock"}
      data-agent-surface={agentActive || undefined}
      data-dock-frame={frameAttr}
      data-resizing={resizing || undefined}
      data-moving={(windowed && movingPopout) || undefined}
      style={windowStyle ?? dockStyle}
      role="complementary"
      aria-label={isAgentLikeKind(active?.kind) ? "Agent" : "Terminal"}
    >
      {windowed ? (
        <>
          <ResizeHandle
            axis="w"
            className="dock-popout-resize-w"
            onMouseDown={startPopoutResize("w")}
          />
          <ResizeHandle
            axis="s"
            className="dock-popout-resize-s"
            onMouseDown={startPopoutResize("s")}
          />
        </>
      ) : dockFrame === "dock" ? (
        <ResizeHandle
          axis="s"
          className="terminal-dock-resize"
          onMouseDown={startDockResize}
        />
      ) : null}
      {proposal && (
        <TerminalProposeBar
          key={proposal.id}
          proposal={proposal}
          busy={activeBusy}
          queued={!!proposal && injectQueuedId === proposal.id}
          injectError={injectError}
          onDeny={() => {
            const denied = proposal;
            pendingInjectRef.current.forEach((pending, tabId) => {
              if (pending.proposalId === denied.id) pendingInjectRef.current.delete(tabId);
            });
            setInjectQueuedId(null);
            setInjectError(null);
            patchServerProposal(denied, "deny");
            const scaffoldId = proposalScaffoldTabsRef.current.get(denied.id);
            proposalScaffoldTabsRef.current.delete(denied.id);
            setProposalQueue((prev) => prev.filter((p) => p.id !== denied.id));
            if (scaffoldId != null) {
              const tab = tabsRef.current.find((t) => t.id === scaffoldId);
              // Close empty Agent tab corpse if we opened it only for this chip.
              if (tab && !tab.busy && tab.lastExitCode == null && !pendingInjectRef.current.has(scaffoldId)) {
                closeTab(scaffoldId);
              }
            }
          }}
          onConfirm={(command) => {
            const current = proposal;
            const injectKind = injectKindForPropose({ kind: current.kind, source: current.source });
            const serverTracked = current.source === "mcp" || current.source === "ui";
            proposalScaffoldTabsRef.current.delete(current.id);
            setInjectError(null);
            const found =
              findTabForOpen(tabsRef.current, {
                cwd: current.cwd,
                label: current.label,
                kind: injectKind,
                repoName: current.repoName,
                preferAgentTab: false,
                mode: current.mode,
              })?.id ?? null;
            const target =
              found ??
              addTab({
                cwd: current.cwd,
                label: current.label,
                kind: injectKind,
                repoName: current.repoName,
                preferAgentTab: false,
                mode: current.mode,
              }).id;
            setActiveId(target);
            if (current.mode) {
              setTabs((prev) =>
                prev.map((t) => (t.id === target ? { ...t, lastMode: current.mode } : t)),
              );
            }
            pendingInjectRef.current.set(target, {
              command,
              proposalId: current.id,
              serverTracked,
              quiet: false,
              mode: current.mode,
            });
            // Mark approved while queued so MCP pollers aren't stuck on pending.
            patchServerProposal(current, "approve", { finalCommand: command });
            setInjectQueuedId(current.id);
            flushPendingInject(target);
            // Proposal stays visible (queued) until flush succeeds or fails.
          }}
        />
      )}
      {/* In the floating window the empty bar drags it; buttons and tabs stay clickable. */}
      <div
        className="terminal-dock-bar"
        onMouseDown={windowed ? startPopoutMove : undefined}
      >
        {/* Tabs scroll; + / templates stay outside overflow so the menu can overlay the pane. */}
        <div className="terminal-dock-tabs-cluster">
          <div className="terminal-dock-tabs" role="tablist" aria-label="Terminal tabs">
            {tabs.map((tab) => (
              <span
                key={tab.id}
                role="tab"
                tabIndex={0}
                aria-selected={tab.id === active?.id}
                className="terminal-dock-tab"
                data-active={tab.id === active?.id || undefined}
                data-kind={tab.kind || "shell"}
                data-drop-target={agentDropTabId === tab.id || undefined}
                onClick={() => {
                  setActiveId(tab.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setActiveId(tab.id);
                  }
                }}
                onDragEnter={(e) => {
                  if (!isAgentLikeKind(tab.kind)) return;
                  if (!dataTransferHasTerminalSelection(e.dataTransfer)) return;
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = "copy";
                  setAgentDropTabId(tab.id);
                }}
                onDragOver={(e) => {
                  if (!isAgentLikeKind(tab.kind)) return;
                  if (!dataTransferHasTerminalSelection(e.dataTransfer)) return;
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = "copy";
                  setAgentDropTabId(tab.id);
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                  setAgentDropTabId((curr) => (curr === tab.id ? null : curr));
                }}
                onDrop={(e) => {
                  if (!isAgentLikeKind(tab.kind)) return;
                  const text = readTerminalSelection(e.dataTransfer);
                  setAgentDropTabId(null);
                  setTerminalSelectionDrag(false);
                  if (!text) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setActiveId(tab.id);
                  insertAgentComposer({ tabId: tab.id, text });
                }}
              >
                <span className="terminal-dot" data-status={tab.status} aria-hidden />
                <span className="terminal-dock-tab-label">
                  {tab.kind && tab.kind !== "shell" && !isAgentLikeKind(tab.kind) ? (
                    <span className="terminal-dock-kind">
                      {tab.kind === "upstart"
                        ? "Upstart"
                        : tab.kind === "devserver"
                          ? "Dev"
                          : tab.kind === "capture"
                            ? "Capture"
                            : tab.kind}
                    </span>
                  ) : null}
                  {tab.label}
                </span>
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
          </div>
          <div className="terminal-dock-new-wrap" ref={templatesWrapRef}>
            <HoverTip label="New terminal" pos="top">
              <button
                type="button"
                className="hub-icon-btn terminal-dock-btn"
                onClick={() => addTab()}
                aria-label="New terminal"
              >
                <Plus size={13} aria-hidden />
                <span className="hub-btn-label">New</span>
              </button>
            </HoverTip>
            <HoverTip label="Templates" pos="top">
              <button
                type="button"
                className="hub-icon-btn terminal-dock-btn"
                aria-label="Tab templates"
                aria-expanded={templatesOpen}
                aria-haspopup="menu"
                onClick={() => setTemplatesOpen((v) => !v)}
              >
                <ChevronDown size={12} aria-hidden />
              </button>
            </HoverTip>
            {templatesOpen && (
              <div className="terminal-dock-templates" role="menu">
                {TERMINAL_TAB_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    role="menuitem"
                    className="terminal-dock-template-item"
                    onClick={() => {
                      setTemplatesOpen(false);
                      if (tpl.id === "agent") {
                        void openInteractiveAgentSession({
                          cwd: active?.cwd,
                          repoName: active?.repoName,
                        });
                        return;
                      }
                      addTab({
                        label: tpl.label,
                        kind: tpl.kind,
                        command: tpl.command,
                      });
                    }}
                  >
                    {tpl.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="terminal-dock-actions">
          {active?.reattached && !isAgentLikeKind(active.kind) && (
            <span className="terminal-dock-banner" title="Reattached to a running session">
              restored
            </span>
          )}
          {typeof active?.lastExitCode === "number" && !isAgentLikeKind(active.kind) && (
            <span className="terminal-dock-banner" data-exit={active.lastExitCode === 0 ? "ok" : "fail"}>
              exit {active.lastExitCode}
            </span>
          )}
          {active?.cwd && !isAgentLikeKind(active.kind) && (
            <span className="terminal-dock-cwd">{active.cwd.replace(/^\/Users\/[^/]+/, "~")}</span>
          )}
          {showSessionActions && (
            <div className="terminal-view-toggle" role="group" aria-label="Terminal view">
              <HoverTip label="Blocks view (Warp-style)" pos="top-end">
                <button
                  type="button"
                  aria-label="Blocks view"
                  aria-pressed={viewMode === "blocks"}
                  data-active={viewMode === "blocks" || undefined}
                  onClick={() => switchViewMode("blocks")}
                >
                  <ListTree size={12} aria-hidden />
                </button>
              </HoverTip>
              <HoverTip label="Raw terminal" pos="top-end">
                <button
                  type="button"
                  aria-label="Raw terminal view"
                  aria-pressed={viewMode === "raw"}
                  data-active={viewMode === "raw" || undefined}
                  onClick={() => switchViewMode("raw")}
                >
                  <SquareTerminal size={12} aria-hidden />
                </button>
              </HoverTip>
            </div>
          )}
          {showSessionActions && railApplies && (
            <HoverTip
              label={railHidden ? "Show command history" : "Hide command history"}
              pos="top-end"
            >
              <button
                type="button"
                className="hub-icon-btn terminal-dock-btn"
                data-on={!railHidden || undefined}
                onClick={() => setRailHiddenPref(!railHidden)}
                aria-pressed={!railHidden}
                aria-label="Toggle command history"
              >
                <History size={12} aria-hidden />
              </button>
            </HoverTip>
          )}
          {showSessionActions && (
            <HoverTip
              label={notifyDone ? "Notify on finished commands: on" : "Notify when long commands finish"}
              pos="top-end"
            >
              <button
                type="button"
                className="hub-icon-btn terminal-dock-btn"
                data-on={notifyDone || undefined}
                onClick={toggleNotifyDone}
                aria-pressed={notifyDone}
                aria-label="Toggle finish notifications"
              >
                {notifyDone ? <Bell size={12} aria-hidden /> : <BellOff size={12} aria-hidden />}
              </button>
            </HoverTip>
          )}
          {showSessionActions && (
            <HoverTip
              label={
                savedNote === "failed"
                  ? "Save failed"
                  : savedNote
                    ? `Saved ${savedNote}`
                    : "Save selection/last block to notes"
              }
              pos="top-end"
            >
              <button
                type="button"
                className="hub-icon-btn terminal-dock-btn"
                onClick={() => void saveActiveToNote()}
                aria-label="Save terminal output to note"
              >
                <FileText size={12} aria-hidden />
                <span className="hub-btn-label">{savedNote && savedNote !== "failed" ? "Saved" : "Note"}</span>
              </button>
            </HoverTip>
          )}
          {showSessionActions && (
            <HoverTip label={copied ? "Copied!" : "Copy all output"} pos="top-end">
              <button
                type="button"
                className="hub-icon-btn terminal-dock-btn"
                onClick={copyActive}
                aria-label={copied ? "Copied" : "Copy all terminal output"}
              >
                {copied ? <Check size={12} aria-hidden /> : <ClipboardCopy size={12} aria-hidden />}
                <span className="hub-btn-label">{copied ? "Copied" : "Copy"}</span>
              </button>
            </HoverTip>
          )}
          {showSessionActions && (
            <HoverTip label={restartArmed ? "Click again to confirm" : "Restart session"} pos="top-end">
              <button
                type="button"
                className="hub-icon-btn terminal-dock-btn"
                data-armed={restartArmed || undefined}
                onClick={() => handleRestart(active.id)}
                aria-label={restartArmed ? "Click again to confirm restart" : "Restart session"}
              >
                <RotateCw size={12} aria-hidden />
                <span className="hub-btn-label">{restartArmed ? "Confirm?" : "Restart"}</span>
              </button>
            </HoverTip>
          )}
          <DockFrameControls
            frame={dockFrame}
            onSplit={
              tabs.some((t) => isAgentLikeKind(t.kind)) ? () => toggleSplit(active) : undefined
            }
            onPopOut={() => {
              if (!active) return;
              setDockFrame(dockFrame === "popout" ? "dock" : "popout");
            }}
          />
          <HoverTip label="Hide (⌃`)" pos="top-end">
            <button
              type="button"
              className="hub-icon-btn terminal-dock-btn"
              onClick={collapseDock}
              aria-label="Hide terminal (sessions keep running)"
            >
              <ChevronDown size={14} aria-hidden />
              <span className="hub-btn-label">Hide</span>
            </button>
          </HoverTip>
        </div>
      </div>
      <div className="terminal-dock-body" data-split={splitOn || undefined}>
        {tabs.map((tab) => {
          // Blocks pane replaces the grid unless a full-screen app owns it.
          const blocksOn = viewMode === "blocks" && altBufferTabs[tab.id] !== true;

          const agentPane = isAgentLikeKind(tab.kind) ? (
            <div className="terminal-agent-pane" data-phase={tab.agentPhase}>
              {tab.agentPhase ? (
                <AgentStatusStrip
                  phase={tab.agentPhase}
                  summary={tab.agentSummary}
                  providerLabel={tab.agentProvider}
                  onClear={() => {
                    window.dispatchEvent(
                      new CustomEvent(AGENT_CHAT_CLEAR_EVENT, { detail: { tabId: tab.id } }),
                    );
                  }}
                />
              ) : null}
              <div className="terminal-agent-body" data-phase={tab.agentPhase}>
                <AgentChatPanel
                  tabId={tab.id}
                  cwd={tab.cwd}
                  providerLabel={tab.agentProvider}
                  phase={tab.agentPhase}
                  seed={tab.chatSeed}
                  frame={dockFrame}
                  unavailableMessage={tab.agentSummary}
                  shellContext={{
                    cwd: tab.cwd ?? shellForAgent?.cwd,
                    repoName: tab.repoName ?? shellForAgent?.repoName,
                    lastBlock: shellLastBlock,
                  }}
                  onRunInTerminal={(command) => {
                    proposeTerminalRun({
                      command,
                      cwd: tab.cwd ?? shellForAgent?.cwd,
                      kind: "shell",
                      repoName: tab.repoName ?? shellForAgent?.repoName,
                      preferAgentTab: false,
                      summary: "Run in terminal",
                      source: "ui",
                    });
                  }}
                  onRequestDock={() => {
                    setDockFrame("dock");
                  }}
                  onSeedConsumed={() => {
                    setTabs((prev) =>
                      prev.map((t) => (t.id === tab.id ? { ...t, chatSeed: undefined } : t)),
                    );
                  }}
                  onPhase={(phase, summary) => {
                    setTabs((prev) =>
                      prev.map((t) =>
                        t.id === tab.id
                          ? {
                              ...t,
                              agentPhase: phase,
                              ...(summary ? { agentSummary: summary } : {}),
                              chatSeed:
                                phase === "running" || phase === "ready" || phase === "failed"
                                  ? undefined
                                  : t.chatSeed,
                            }
                          : t,
                      ),
                    );
                  }}
                />
              </div>
            </div>
          ) : (
            <div
              className="terminal-session-stack"
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                termMenu.openAt(e, tab.id);
              }}
            >
              <div className="terminal-session-xterm" data-under={blocksOn || undefined}>
                <TerminalSession
                  cwd={tab.cwd}
                  command={tab.command}
                  attachSessionId={tab.sessionId}
                  killOnUnmount={false}
                  active={open && tab.id === active?.id}
                  autoFocus={open && tab.id === active?.id && !proposal && !blocksOn}
                  fontSize={fontSize ?? TERMINAL_FONT_SIZE_DEFAULT}
                  onStatus={(s) => setStatus(tab.id, s)}
                  onSessionId={(sid) => setSessionId(tab.id, sid)}
                  onBusy={(busy) => {
                    setTabs((prev) => {
                      const cur = prev.find((t) => t.id === tab.id);
                      if (!cur) return prev;
                      if (cur.busy === busy) return prev;
                      return prev.map((t) => (t.id === tab.id ? { ...t, busy } : t));
                    });
                    // Long-command-finished notification while hidden.
                    const since = busySinceRef.current.get(tab.id);
                    if (busy) {
                      busySinceRef.current.set(tab.id, Date.now());
                    } else {
                      busySinceRef.current.delete(tab.id);
                      if (
                        shouldNotifyCommandFinished({
                          startedAt: since,
                          now: Date.now(),
                          notifyEnabled: notifyDone,
                          dockOpen: openRef.current,
                          documentHidden: document.hidden,
                          permission:
                            typeof Notification === "undefined"
                              ? "unsupported"
                              : Notification.permission,
                        })
                      ) {
                        try {
                          new Notification("DevHub terminal", {
                            body: `${tab.label} — command finished`,
                          });
                        } catch {
                          /* notification failures are never fatal */
                        }
                      }
                    }
                    // With shell integration, OSC 133 D owns completion — the
                    // busy heuristic misfires on silent stretches inside zsh
                    // init and long builds, splitting one command into many
                    // blocks. Heuristic completion is the no-integration path.
                    if (!busy && !readersRef.current.get(tab.id)?.hasShellIntegration?.()) {
                      completeCommandBlocks(tab.id);
                    }
                    if (busy && !openRef.current) setUnread(true);
                  }}
                  onExitCode={(code) => {
                    setTabs((prev) =>
                      prev.map((t) => (t.id === tab.id ? { ...t, lastExitCode: code } : t)),
                    );
                    if (!openRef.current) setUnread(true);
                  }}
                  onCommandExit={(code) => {
                    completeCommandBlocks(tab.id, code);
                    setTabs((prev) =>
                      prev.map((t) => (t.id === tab.id ? { ...t, lastExitCode: code } : t)),
                    );
                  }}
                  onAltBuffer={(alt) =>
                    setAltBufferTabs((prev) =>
                      prev[tab.id] === alt ? prev : { ...prev, [tab.id]: alt },
                    )
                  }
                  onReattached={(reattached) =>
                    setTabs((prev) =>
                      prev.map((t) => (t.id === tab.id ? { ...t, reattached } : t)),
                    )
                  }
                  onCommandSubmit={(command) => beginCommandBlock(tab.id, command, "typed")}
                  onOscCommand={(command) => beginCommandBlock(tab.id, command, "osc")}
                  onTypedLine={(line) =>
                    setLiveLines((prev) =>
                      prev[tab.id] === line ? prev : { ...prev, [tab.id]: line },
                    )
                  }
                  onReader={(reader) => {
                    if (reader) {
                      readersRef.current.set(tab.id, reader);
                      // A launched tab command (upstart etc.) always gets a
                      // block — OSC detection of the echoed line is unreliable
                      // while the shell is still starting up.
                      if (tab.command && !launchedBlockTabsRef.current.has(tab.id)) {
                        launchedBlockTabsRef.current.add(tab.id);
                        beginCommandBlock(tab.id, tab.command, "inject");
                      }
                      flushPendingInject(tab.id);
                    } else readersRef.current.delete(tab.id);
                  }}
                />
                {!blocksOn && !railHidden && (
                  <TerminalBlockHistory
                    blocks={commandBlocks[tab.id] ?? []}
                    onCopy={(block) => {
                      void copyTextToClipboard(block.output.trim() || block.command);
                    }}
                    onSend={(block) => sendTerminalToAgent(tab, formatBlockForAgent(block))}
                    onRerun={(block) => runPromptCommand(tab, block.command)}
                    onExplain={(block) => explainFailedBlock(tab, block)}
                    onJump={(block) => jumpToBlock(tab, block)}
                    onDismiss={() => setRailHiddenPref(true)}
                  />
                )}
              </div>
              {blocksOn && (
                <div
                  className="terminal-blocks-pane"
                  onMouseDown={(e) => {
                    // The grid is hidden in blocks view, so the console pane is
                    // read-only DOM — refocus the prompt editor on plain clicks
                    // or keystrokes vanish (target was never an editable).
                    const target = e.target as HTMLElement;
                    if (target.closest("button, a, input, textarea")) return;
                    promptInputsRef.current.get(tab.id)?.focus({ preventScroll: true });
                  }}
                >
                  <TerminalBlocksView
                    blocks={commandBlocks[tab.id] ?? []}
                    waitingInputId={
                      inputWaiting[tab.id]
                        ? (commandBlocks[tab.id] ?? []).find((b) => b.pending)?.id
                        : undefined
                    }
                    onCopy={(block) => {
                      void copyTextToClipboard(block.output.trim() || block.command);
                    }}
                    onSend={(block) => sendTerminalToAgent(tab, formatBlockForAgent(block))}
                    onRerun={(block) => runPromptCommand(tab, block.command)}
                    onExplain={(block) => explainFailedBlock(tab, block)}
                    onJump={(block) => jumpToBlock(tab, block)}
                  />
                </div>
              )}
              <TerminalAskCard
                state={askStates[tab.id]}
                onDismiss={() =>
                  setAskStates((prev) => {
                    const next = { ...prev };
                    delete next[tab.id];
                    return next;
                  })
                }
              />
              <TerminalPromptBar
                cwd={tab.cwd}
                repoName={tab.repoName}
                lastCommand={lastCommands[tab.id]}
                history={terminalHistory}
                asking={askingTabId === tab.id}
                focused={open && tab.id === active?.id && !proposal && blocksOn}
                inputHint={inputWaiting[tab.id]}
                liveLine={liveLines[tab.id]}
                onRun={(command) => runPromptCommand(tab, command)}
                onAsk={(text) => void askPromptCommand(tab, text)}
                onCancelAsk={() => askAbortRef.current?.abort()}
                onRerun={(command) => runPromptCommand(tab, command)}
                onSendLastToAgent={(command) => sendTerminalToAgent(tab, command)}
                inputRef={(el) => promptInputsRef.current.set(tab.id, el)}
              />
            </div>
          );

          const inSplit = splitOn && (tab.id === splitAgent?.id || tab.id === splitShell?.id);
          const visible = inSplit || (!splitOn && tab.id === active?.id);

          return (
            <div
              key={`${tab.id}-${tab.generation}`}
              data-split-pane={
                inSplit ? (isAgentLikeKind(tab.kind) ? "agent" : "shell") : undefined
              }
              style={{
                display: visible ? "block" : "none",
                height: "100%",
              }}
            >
              {agentPane}
            </div>
          );
        })}
      </div>
      <ContextMenu
        open={termMenu.target != null}
        position={termMenu.position}
        groups={termMenuGroups}
        onClose={termMenu.close}
        label="Terminal"
      />
    </div>
  );
}

/** Top-bar toggle — lives in the quick cluster. */
export function TerminalDockButton() {
  const [activeCount, setActiveCount] = useState(latestTerminalSummary.activeCount);
  const [unread, setUnread] = useState(latestTerminalSummary.unread);
  const shortcut = "⌃`";
  const terminalLabel = unread
    ? `Terminal has new activity (${shortcut})`
    : activeCount > 0
      ? `${activeCount} active terminal${activeCount === 1 ? "" : "s"} (${shortcut})`
      : `Terminal (${shortcut})`;

  useEffect(() => {
    const onSummary = (event: Event) => {
      const detail = (event as CustomEvent<TerminalSummary>).detail;
      setActiveCount(detail?.activeCount ?? 0);
      setUnread(detail?.unread ?? false);
    };
    window.addEventListener("devhub:terminal-summary", onSummary);
    return () => window.removeEventListener("devhub:terminal-summary", onSummary);
  }, []);

  return (
    <HoverTip label={terminalLabel} pos="bottom-end">
      <button
        type="button"
        className="hub-icon-btn terminal-toggle-btn"
        onClick={() => window.dispatchEvent(new CustomEvent("devhub:terminal-toggle"))}
        aria-label={terminalLabel}
      >
        <TerminalSquare size={14} aria-hidden />
        {unread ? (
          <span
            className="terminal-toggle-count"
            style={{ background: "var(--warning)", color: "var(--bg-surface)" }}
            aria-hidden="true"
          >
            !
          </span>
        ) : (
          activeCount > 0 && (
            <span className="terminal-toggle-count" aria-hidden="true">
              {activeCount}
            </span>
          )
        )}
      </button>
    </HoverTip>
  );
}
