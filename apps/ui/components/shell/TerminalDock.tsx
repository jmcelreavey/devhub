"use client";

import {
ContextMenu,
useContextMenu,
type ContextMenuGroup,
} from "@/components/shell/ContextMenu";
import { DockFrameControls } from "@/components/shell/DockFrameControls";
import { ResizeHandle } from "@/components/shell/ResizeHandle";
import { TerminalBlockHistory } from "@/components/shell/TerminalBlockHistory";
import { TerminalProposeBar } from "@/components/shell/TerminalProposeBar";
import {
TERMINAL_FONT_SIZE_DEFAULT,
TERMINAL_FONT_SIZE_MAX,
TERMINAL_FONT_SIZE_MIN,
WTermSession,
readTerminalFontSize,
writeTerminalFontSize,
type Status,
type TerminalReader,
} from "@/components/shell/WTermSession";
import { HoverTip } from "@/components/ui/HoverTip";
import { openAgentHandoff } from "@/lib/agent-handoff";
import { openInteractiveAgentSession } from "@/lib/agent/job";
import { copyTextToClipboard,readTextFromClipboard } from "@/lib/clipboard";
import { notify,notifyPermission,requestNotifyPermission } from "@/lib/desktop/bridge";
import { RESIZE_AXES, RESIZE_CURSORS, resizeRect, startDragResize, type ResizeAxis } from "@/lib/drag-resize";
import { useToast } from "@/lib/hooks/use-toast";
import { subscribeToTaskEvents } from "@/lib/events/task-subscription";
import { useControlShortcutLabel } from "@/lib/hooks/use-modifier-key";
import {
capBlockOutput,
formatBlockForAgent,
newTerminalBlockId,
sliceNewOutput,
stripCommandEcho,
terminalBufferMarker,
type TerminalCommandBlock,
} from "@/lib/terminal/blocks";
import { lastTerminalBlock,saveTerminalCaptureNote } from "@/lib/terminal/capture";
import { resolveTerminalCopyText } from "@/lib/terminal/clipboard";
import {
AGENT_TAB_CLOSE_DELAY_MS,clampDockHeight,clampPopoutPos,injectKindForPropose,isAgentRunSource,readAlwaysExpandPref,
readAutoRunPref,readDockHeight,
readPersistedDockState,
readPopoutPos,readTerminalPopoutSize,shouldInjectProposal,shouldExpandOnTerminalOpen,
shouldAutoCloseAgentTab,
shouldNotifyCommandFinished,writeAutoRunPref,writeDockHeight,
writePersistedDockState,
writePopoutPos,writeTerminalPopoutSize,type DockFrame,type NotificationPermissionState,
type PopoutPos
} from "@/lib/terminal/dock-state";
import {
TERMINAL_FOCUS_EVENT,
TERMINAL_PROPOSE_EVENT,
formatTerminalInjectPayload,
isDestructiveTerminalCommand,
proposeTerminalRun,
quietInjectCommand,
type TerminalFocusDetail,
type TerminalProposeDetail,
} from "@/lib/terminal/inject";
import {
TERMINAL_TAB_TEMPLATES,
formatTerminalTabLabel,
isAgentLikeKind,
type TerminalSessionKind,
} from "../../../../packages/shared/ui-lib/terminal/meta";
import {
Bell,
BellOff,
Check,
ChevronDown,
ClipboardCopy,
ClipboardPaste,
FileText,
History,
Play,
Plus,
RotateCw,
Scissors,
Sparkles,
SquareTerminal,
TerminalSquare,
X,
} from "lucide-react";
import { useCallback,useEffect,useRef,useState } from "react";
import "./terminal-workspace.css";

/** Starting size for a freshly popped-out window, before the user resizes it. */
const POPOUT_DEFAULT = { w: 720, h: 520 };

const NOTIFY_PREF_KEY = "devhub:terminal-notify";

function outputMarker(text: string): string {
  // The cursor can append to the final row instead of starting a new one.
  return terminalBufferMarker(text).replace(/\n$/, "");
}


interface DockTab {
  id: number;
  cwd?: string;
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
  /** Opened for an MCP command; close after completion, retaining the disk transcript. */
  agentRun?: boolean;
  agentCommandPending?: boolean;
  agentExitCode?: number;
}

interface OpenDetail {
  agentRun?: boolean;
  cwd?: string;
  label?: string;
  command?: string;
  kind?: TerminalSessionKind;
  repoName?: string;
  mode?: "oneshot" | "interactive";
  summary?: string;
  providerLabel?: string;
}

interface PendingInject {
  command: string;
  agentCommand?: boolean;
  proposalId?: string;
  /** True when the proposal came from the server store (MCP/API). */
  serverTracked?: boolean;
  /** Hide inject echo (agent oneshots) — stty -echo then clear. */
  quiet?: boolean;
  mode?: "oneshot" | "interactive";
  quietSetup?: (exitCode: number) => void;
  quietEchoDisabled?: boolean;
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
 * Global terminal drawer — toggled from anywhere with Control-backtick
 * (⌃` on a Mac, Ctrl+` elsewhere) or the top-bar button,
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
  const shortcut = useControlShortcutLabel()("`");
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
  const copyAbortRef = useRef<AbortController | null>(null);
  const [menuCopyText, setMenuCopyText] = useState("");
  const [menuHasTerminalSelection, setMenuHasTerminalSelection] = useState(false);
  const menuCutRef = useRef<(() => boolean) | null>(null);
  const openedTabsRef = useRef(new Set<number>());
  useEffect(() => () => {
    copyAbortRef.current?.abort();
  }, [activeId, open]);
  const sessionStacksRef = useRef(new Map<number, HTMLDivElement | null>());
  /** Commands waiting for a reattached/reused tab's reader to come online. */
  const pendingInjectRef = useRef(new Map<number, PendingInject>());
  const addTabRef = useRef<(detail?: OpenDetail) => { id: number; created: boolean }>(
    () => ({ id: -1, created: false }),
  );
  /** Tabs opened only to host a proposal confirm — close on deny if unused. */
  const proposalScaffoldTabsRef = useRef(new Map<string, number>());
  /** Server proposal ids this session already acted on (chip or auto-run). */
  const handledProposalIdsRef = useRef(new Set<string>());
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
  const [commandBlocks, setCommandBlocks] = useState<Record<number, TerminalCommandBlock[]>>({});
  const blockMarkersRef = useRef(new Map<string, string>());
  const awaitingInjectedOscRef = useRef(new Map<number, string>());
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
  /** OS notification when a long command finishes hidden. */
  const [notifyDone, setNotifyDone] = useState(false);
  /**
   * Cached notification permission. The busy handler decides synchronously, and
   * the desktop permission check is an async plugin call, so it is read here and
   * refreshed whenever the toggle moves.
   */
  const notifyPermissionRef = useRef<NotificationPermissionState>("default");
  /** Agent command rail dismissed until the user reopens it. */
  const [railHidden, setRailHidden] = useState(false);
  /** Skip the confirm chip and inject proposals straight away. */
  const [autoRun, setAutoRun] = useState(true);
  /**
   * Read by the propose handler and the MCP poll loop, which are memoised on
   * deps that must not churn every time the toggle moves.
   */
  const autoRunRef = useRef(true);
  /** When each tab went busy — duration source for the notification. */
  const busySinceRef = useRef(new Map<number, number>());
  /** Agent tabs whose command was written and has not reported an exit yet. */
  const agentCommandSentRef = useRef(new Set<number>());
  const agentCloseTimersRef = useRef(new Map<number, number>());
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

  const resolveHostApproval = useCallback(async (detail: TerminalProposeDetail, action: "approve" | "deny") => {
    setInjectQueuedId(detail.id);
    setInjectError(null);
    try {
      const response = await fetch("/api/terminal/propose", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: detail.id, action }),
      });
      if (!response.ok) throw new Error("Could not save the decision");
      const data = await response.json() as { proposal?: { status?: string } };
      if (data.proposal?.status !== (action === "approve" ? "approved" : "denied")) throw new Error("This approval is no longer pending");
      setProposalQueue(prev => prev.filter(item => item.id !== detail.id));
    } catch (error) {
      setInjectError(error instanceof Error ? error.message : "Could not save the decision");
    } finally { setInjectQueuedId(null); }
  }, []);

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
      for (const tab of saved.tabs) {
        if (tab.agentRun && tab.agentCommandPending) agentCommandSentRef.current.add(tab.id);
      }
      userCollapsedRef.current = saved.userCollapsed;
      setTabs(
        saved.tabs.filter((tab) => !isAgentLikeKind(tab.kind) || tab.sessionId).map((tab) => ({
          id: tab.id,
          cwd: tab.cwd,
          label: tab.label,
          sessionId: tab.sessionId,
          kind: tab.kind,
          repoName: tab.repoName,
          agentRun: tab.agentRun,
          agentCommandPending: tab.agentCommandPending,
          agentExitCode: tab.agentExitCode,
          status: "connecting" as Status,
          generation: 0,
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
        agentRun: tab.agentRun,
        agentCommandPending: tab.agentCommandPending,
        agentExitCode: tab.agentExitCode,
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
    if (saved != null) setDockHeight(saved);
    const savedPopout = readTerminalPopoutSize();
    if (savedPopout) setPopoutSize(savedPopout);
    const savedPos = readPopoutPos();
    if (savedPos) setPopoutPos(savedPos);
  }, []);

  useEffect(() => {
    dockHeightRef.current = dockHeight;
  }, [dockHeight]);

  // Client-only prefs: font size, auto-run and notifications.
  useEffect(() => {
    setFontSize(readTerminalFontSize());
    const savedAutoRun = readAutoRunPref();
    autoRunRef.current = savedAutoRun;
    setAutoRun(savedAutoRun);
    try {
      setNotifyDone(window.localStorage.getItem(NOTIFY_PREF_KEY) === "1");
    } catch {
      /* private mode */
    }
    void notifyPermission().then((state) => {
      notifyPermissionRef.current = state;
    });
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
      if (next) {
        void (async () => {
          const current = await notifyPermission();
          notifyPermissionRef.current =
            current === "default" ? await requestNotifyPermission() : current;
        })();
      }
      return next;
    });
  }, []);

  const toggleAutoRun = useCallback(() => {
    setAutoRun((prev) => {
      const next = !prev;
      writeAutoRunPref(next);
      autoRunRef.current = next;
      return next;
    });
  }, []);

  /**
   * Drag the dock's top edge. The shield keeps the drag alive over the terminal
   * grid, and each session's ResizeObserver refits, so the shell reflows live.
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

  /**
   * Agent and MCP work raises the dock only if the user has not put it away.
   * A collapsed dock gets the unread dot instead; opening it clears the flag.
   */
  const expandForAgentWork = useCallback(() => {
    if (shouldExpandOnTerminalOpen({ userCollapsed: userCollapsedRef.current, alwaysExpand: readAlwaysExpandPref() })) {
      expandDock();
    } else {
      setUnread(true);
    }
  }, [expandDock]);

  const collapseDock = useCallback(() => {
    userCollapsedRef.current = true;
    openRef.current = false;
    setOpen(false);
    if (proposalQueue.length > 0) setUnread(true);
  }, [proposalQueue.length]);

  const completeCommandBlocks = useCallback((tabId: number, exitCode?: number) => {
    const reader = readersRef.current.get(tabId);
    const after = reader?.getBuffer() ?? "";
    const markers = new Map(blockMarkersRef.current);
    awaitingInjectedOscRef.current.delete(tabId);
    setCommandBlocks((prev) => {
      const list = prev[tabId];
      if (!list?.some((b) => b.pending)) return prev;
      return {
        ...prev,
        [tabId]: list.map((b) => {
          if (!b.pending) return b;
          const marker = markers.get(b.id);
          blockMarkersRef.current.delete(b.id);
          const raw = sliceNewOutput(marker ?? "", after);
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

  const beginCommandBlock = useCallback(
    (tabId: number, command: string) => {
      const cmd = command.trim();
      if (!cmd) return;
      completeCommandBlocks(tabId);
      const reader = readersRef.current.get(tabId);
      const id = newTerminalBlockId();
      if (reader?.hasShellIntegration()) awaitingInjectedOscRef.current.set(tabId, id);
      blockMarkersRef.current.set(id, outputMarker(reader?.getBuffer() ?? ""));
      setCommandBlocks((prev) => ({
        ...prev,
        [tabId]: [...(prev[tabId] ?? []), {
          id,
          command: cmd,
          output: "",
          startedAt: Date.now(),
          pending: true,
        }].slice(-40),
      }));
    },
    [completeCommandBlocks],
  );

  const markInjectedCommandStart = useCallback((tabId: number) => {
    const id = awaitingInjectedOscRef.current.get(tabId);
    if (!id) return;
    awaitingInjectedOscRef.current.delete(tabId);
    if (blockMarkersRef.current.has(id)) {
      blockMarkersRef.current.set(id, outputMarker(readersRef.current.get(tabId)?.getBuffer() ?? ""));
    }
  }, []);

  /** Tabs with a flush loop already running — onReader + setStatus both call
   * flush on session open; two loops would write the command twice. */
  const flushingInjectRef = useRef(new Set<number>());
  /** Tabs whose quiet inject will report its own exit — idle is not completion there. */
  const injectExitPendingRef = useRef(new Set<number>());

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
      // A WebSocket being open only means the PTY exists. Login zsh still has
      // to finish its rc files before ZLE can interpret bracketed paste.
      if (!reader.isReadyForInput()) {
        flushingInjectRef.current.delete(tabId);
        return;
      }

      const fail = (message: string) => {
        flushingInjectRef.current.delete(tabId);
        pendingInjectRef.current.delete(tabId);
        setInjectQueuedId(null);
        setInjectError(message);
        toast.error(message);
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
        if (tabsRef.current.find((t) => t.id === tabId)?.agentRun) {
          agentCommandSentRef.current.add(tabId);
          setTabs((prev) => prev.map((tab) => tab.id === tabId
            ? { ...tab, agentCommandPending: true, agentExitCode: undefined } : tab));
        }
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
      };

      /**
       * A brand-new tab's socket is usually still connecting 200ms in, and
       * `write` refuses (sends nothing) until it opens. Failing on that first
       * refusal dropped the command, and the later "open" flush found nothing
       * queued — so retry until the socket opens (~10s), then give up.
       */
      const INJECT_WRITE_RETRIES = 40;
      const INJECT_WRITE_RETRY_MS = 250;
      const writeWhenOpen = (data: string, onWritten: () => void, attempt = 0) => {
        if (pendingInjectRef.current.get(tabId) !== pending) return;
        const current = readersRef.current.get(tabId) ?? reader;
        if (current.write(data)) {
          onWritten();
          return;
        }
        if (attempt >= INJECT_WRITE_RETRIES) {
          fail("Could not write to the terminal session.");
          return;
        }
        window.setTimeout(() => writeWhenOpen(data, onWritten, attempt + 1), INJECT_WRITE_RETRY_MS);
      };

      const inject = () => {
        // Still queued in the map until write or fail — visible chip stays up.
        if (pendingInjectRef.current.get(tabId) !== pending) return;
        const writeQuiet = () => {
          // Wait for the setup command to finish before sending the real one.
          writeWhenOpen("stty -echo\r", () => {
            pending.quietEchoDisabled = true;
            const sendCommand = () => {
              if (pendingInjectRef.current.get(tabId) !== pending) return;
              pending.quietSetup = undefined;
              // Without integration nothing else reports the exit; the line does it itself.
              const reportExit = !(readersRef.current.get(tabId) ?? reader).hasShellIntegration();
              const payload = formatTerminalInjectPayload(quietInjectCommand(pending.command, reportExit));
              writeWhenOpen(payload, () => {
                if (pending.agentCommand) beginCommandBlock(tabId, pending.command);
                if (reportExit) injectExitPendingRef.current.add(tabId);
                succeed();
              });
            };
            pending.quietSetup = (exitCode) => {
              if (pendingInjectRef.current.get(tabId) !== pending) return;
              if (exitCode !== 0) {
                fail("Could not turn off terminal echo; command was not sent.");
                return;
              }
              sendCommand();
            };
            const startedAt = Date.now();
            const waitForSetup = () => {
              if (pendingInjectRef.current.get(tabId) !== pending || !pending.quietSetup) return;
              if (Date.now() - startedAt >= 10_000) {
                reader.write("stty echo\r");
                fail("Terminal setup timed out; command was not sent.");
                return;
              }
              // Without shell integration, the idle heuristic is the only setup signal.
              if (!reader.hasShellIntegration() && !reader.isBusy()) {
                sendCommand();
                return;
              }
              window.setTimeout(waitForSetup, 100);
            };
            window.setTimeout(waitForSetup, 100);
          });
        };

        const tab = tabsRef.current.find((t) => t.id === tabId);
        const interactive = pending.mode === "interactive" || tab?.lastMode === "interactive";
        // Interactive TUIs own the tty — stty -echo fights their raw mode.
        // Status strip + hidden PTY cover the brief command echo.
        if (pending.quiet && !interactive && !reader.hasShellIntegration()) {
          writeQuiet();
          return;
        }
        writeWhenOpen(formatTerminalInjectPayload(pending.command), () => {
          if (pending.agentCommand && !interactive) beginCommandBlock(tabId, pending.command);
          succeed();
        });
      };
      // Give a fresh session a beat to settle before typing.
      if (pending.proposalId) setInjectQueuedId(pending.proposalId);
      window.setTimeout(inject, 200);
    },
    [beginCommandBlock, toast],
  );

  const addTab = useCallback(
    (detail?: OpenDetail & { pendingProposalId?: string; serverTracked?: boolean }) => {
      // Every open gets its own tab. "Is this one free?" has no reliable answer
      // — a shell at a prompt, a quiet long-running server and a wedged process
      // look identical from here — and guessing wrong queued a command behind a
      // session that never went idle. A spare tab is the cheaper failure.

      const id = ++idRef.current;
      if (detail?.command) {
        pendingInjectRef.current.set(id, { command: detail.command });
      }
      const kind = injectKindForPropose({ kind: detail?.kind });
      const label = formatTerminalTabLabel({
        label: detail?.label,
        kind,
        repoName: detail?.repoName,
        cwd: detail?.cwd,
      });
      setTabs((prev) => [
        ...prev,
        {
          id,
          cwd: detail?.cwd,
          label,
          kind,
          repoName: detail?.repoName,
          status: "connecting",
          generation: 0,
          lastMode: detail?.mode,
          ...(detail?.agentRun ? { agentRun: true } : {}),
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
    [expandDock],
  );

  useEffect(() => {
    addTabRef.current = addTab;
  }, [addTab]);

  const clearAgentTabClose = useCallback((id: number) => {
    window.clearTimeout(agentCloseTimersRef.current.get(id));
    agentCloseTimersRef.current.delete(id);
  }, []);

  const closeTab = useCallback((id: number) => {
    const tab = tabsRef.current.find((t) => t.id === id);
    clearAgentTabClose(id);
    agentCommandSentRef.current.delete(id);
    pendingInjectRef.current.delete(id);
    openedTabsRef.current.delete(id);
    awaitingInjectedOscRef.current.delete(id);
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
  }, [clearAgentTabClose]);

  /**
   * A finished agent command leaves nothing to do in its tab, so it closes
   * itself (which also ends the shell). Keep completion in tab state so a
   * prompt repaint or UI remount cannot permanently cancel cleanup. Starting
   * a new user command relinquishes ownership instead.
   */
  const closeAgentTabAfterExit = useCallback(
    (id: number, exitCode: number | null | undefined) => {
      const tab = tabsRef.current.find((t) => t.id === id);
      if (!shouldAutoCloseAgentTab({ agentRun: tab?.agentRun, exitCode })) return;
      if (agentCloseTimersRef.current.has(id)) return;
      agentCloseTimersRef.current.set(
        id,
        window.setTimeout(() => {
          agentCloseTimersRef.current.delete(id);
          const current = tabsRef.current.find((t) => t.id === id);
          if (!current) return;
          if (current.busy && current.status !== "closed") return;
          if (!current.agentRun || current.agentCommandPending || current.agentExitCode !== exitCode) return;
          closeTab(id);
        }, AGENT_TAB_CLOSE_DELAY_MS),
      );
    },
    [closeTab],
  );

  useEffect(() => {
    for (const tab of tabs) {
      if (tab.agentCommandPending || (tab.busy && tab.status !== "closed")) {
        clearAgentTabClose(tab.id);
      } else {
        closeAgentTabAfterExit(tab.id, tab.agentExitCode);
      }
    }
  }, [tabs, clearAgentTabClose, closeAgentTabAfterExit]);

  useEffect(() => {
    const timers = agentCloseTimersRef.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const keepUserTerminal = useCallback((id: number) => {
    if (agentCommandSentRef.current.has(id)) return;
    if (tabsRef.current.find((tab) => tab.id === id)?.agentExitCode == null) return;
    clearAgentTabClose(id);
    setTabs((prev) => prev.map((tab) => tab.id === id && tab.agentExitCode != null
      ? { ...tab, agentRun: false, agentExitCode: undefined } : tab));
  }, [clearAgentTabClose]);

  const toggle = useCallback(() => {
    if (openRef.current) {
      collapseDock();
      return;
    }
    userCollapsedRef.current = false;
    if (tabsRef.current.length === 0) addTab({ label: "zsh", kind: "shell" });
    expandDock();
  }, [addTab, collapseDock, expandDock]);

  const enqueueProposal = useCallback((detail: TerminalProposeDetail) => {
    setProposalQueue((prev) => {
      if (prev.some((p) => p.id === detail.id)) return prev;
      return [...prev, detail];
    });
    setInjectError(null);
    if (!openRef.current) setUnread(true);
  }, []);

  /**
   * Open a tab and inject without raising a chip. Never puts the command on
   * the new tab — it goes through the pending map after open so server status
   * tracks a real write (no optimistic "injected" PATCH).
   */
  const injectProposalNow = useCallback(
    (detail: TerminalProposeDetail) => {
      const result = addTab({
        cwd: detail.cwd,
        label: detail.label,
        kind: injectKindForPropose({ kind: detail.kind, source: detail.source }),
        repoName: detail.repoName,
        mode: detail.mode,
        summary: detail.summary,
        providerLabel: detail.providerLabel,
        agentRun: isAgentRunSource(detail.source),
      });
      pendingInjectRef.current.set(result.id, {
        command: detail.command,
        agentCommand: detail.source === "mcp" || detail.source === "agent-job",
        proposalId: detail.id,
        serverTracked: detail.source === "mcp" || detail.source === "ui",
        quiet: isAgentRunSource(detail.source),
        mode: detail.mode,
      });
      flushPendingInject(result.id);
    },
    [addTab, flushPendingInject],
  );

  const handlePropose = useCallback(
    (detail: TerminalProposeDetail) => {
      expandForAgentWork();
      const injectKind = injectKindForPropose({ kind: detail.kind, source: detail.source });
      if (shouldInjectProposal({ autoRun: autoRunRef.current, command: detail.command, skipConfirm: detail.skipConfirm, requiresConfirmation: detail.requiresConfirmation })) {
        injectProposalNow(detail);
        return;
      }
      enqueueProposal(detail);
      const beforeIds = new Set(tabsRef.current.map((t) => t.id));
      const result = addTab({
        cwd: detail.cwd,
        label: detail.label,
        kind: injectKind,
        repoName: detail.repoName,
        mode: detail.mode,
        summary: detail.summary,
        providerLabel: detail.providerLabel,
        agentRun: isAgentRunSource(detail.source),
      });
      if (result.created && !beforeIds.has(result.id)) {
        proposalScaffoldTabsRef.current.set(detail.id, result.id);
      }
    },
    [addTab, enqueueProposal, expandForAgentWork, injectProposalNow],
  );

  useEffect(() => {
    const onToggle = () => toggle();
    const onOpen = (e: Event) => {
      addTab((e as CustomEvent<OpenDetail>).detail);
    };
    const onPropose = (e: Event) => handlePropose((e as CustomEvent<TerminalProposeDetail>).detail);
    const onFocus = (e: Event) => {
      const detail = (e as CustomEvent<TerminalFocusDetail>).detail;
      addTab({
        cwd: detail.cwd,
        label: detail.label,
        kind: detail.kind,
        repoName: detail.repoName,
        command: detail.command,
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
      // allowed from the terminal itself (its hidden textarea captures input).
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
    window.addEventListener(TERMINAL_PROPOSE_EVENT, onPropose);
    window.addEventListener(TERMINAL_FOCUS_EVENT, onFocus);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("devhub:terminal-toggle", onToggle);
      window.removeEventListener("devhub:terminal-open", onOpen);
      window.removeEventListener(TERMINAL_PROPOSE_EVENT, onPropose);
      window.removeEventListener(TERMINAL_FOCUS_EVENT, onFocus);
      document.removeEventListener("keydown", onKey);
    };
  }, [toggle, addTab, handlePropose, templatesOpen, dockFrame, closeTab, zoomFont]);

  // Fetch MCP/API proposals on push so OpenCode tools surface in the dock UI (FIFO enqueue).
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    let generation = 0;
    const tick = async () => {
      const requested = ++generation;
      try {
        const res = await fetch("/api/terminal/propose?status=pending");
        if (!res.ok || cancelled || requested !== generation) return;
        const data = (await res.json()) as {
          proposals?: Array<{
            id: string;
            command: string;
            cwd?: string;
            label?: string;
            summary?: string;
            kind?: TerminalSessionKind;
            repoName?: string;
            reason?: string;
            source?: string;
            autoRun?: boolean;
            requiresConfirmation?: boolean;
            hostApproval?: TerminalProposeDetail["hostApproval"];
          }>;
        };
        const pending = data.proposals ?? [];
        if (cancelled || requested !== generation) return;
        const pendingIds = new Set(pending.map(item => item.id));
        setProposalQueue(curr => curr.filter(item => !item.hostApproval || pendingIds.has(item.id)));
        if (pending.length === 0) return;

        const mapped: TerminalProposeDetail[] = pending.map((next) => ({
          id: next.id,
          command: next.command,
          hostApproval: next.hostApproval,
          cwd: next.cwd,
          label: next.label,
          summary: next.summary,
          kind: next.kind ?? "shell",
          repoName: next.repoName,
          reason: next.reason,
          source: next.source === "mcp" ? "mcp" : "ui",
          // Server-authorised proposals can request automatic injection.
          skipConfirm: next.autoRun === true,
          requiresConfirmation: next.requiresConfirmation === true,
        }));

        // An auto-run proposal never enters the queue, so the queue cannot be
        // the dedupe key for it: the next 2.5s tick would still see it pending
        // (the "injected" PATCH lands after the tab opens) and inject twice.
        const fresh = mapped.filter((p) => !handledProposalIdsRef.current.has(p.id));
        if (cancelled || fresh.length === 0) return;
        for (const detail of fresh) handledProposalIdsRef.current.add(detail.id);

        const chips: TerminalProposeDetail[] = [];
        expandForAgentWork();
        for (const detail of fresh) {
          if (!detail.hostApproval && shouldInjectProposal({ autoRun: autoRunRef.current, command: detail.command, skipConfirm: detail.skipConfirm, requiresConfirmation: detail.requiresConfirmation })) {
            injectProposalNow(detail);
          } else {
            chips.push(detail);
          }
        }

        if (chips.length === 0) return;
        setProposalQueue((curr) => {
          const known = new Set(curr.map((p) => p.id));
          const additions = chips.filter((p) => !known.has(p.id));
          if (additions.length === 0) return curr;
          return [...curr, ...additions];
        });
        const focus = chips[0];
        if (focus && !focus.hostApproval) {
          const result = addTab({
            cwd: focus.cwd,
            label: focus.label,
            kind: injectKindForPropose({ kind: focus.kind, source: focus.source }),
            repoName: focus.repoName,
            agentRun: isAgentRunSource(focus.source),
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
    const unsubscribe = subscribeToTaskEvents({
      domains: ["terminal"],
      connection: () => {},
      refresh: () => { void tick(); },
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [hydrated, addTab, expandForAgentWork, injectProposalNow]);

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
    openedTabsRef.current.delete(id);
    awaitingInjectedOscRef.current.delete(id);
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
    copyAbortRef.current?.abort();
    const controller = new AbortController();
    copyAbortRef.current = controller;
    const sid = reader.sessionId() ?? tabsRef.current.find((tab) => tab.id === activeId)?.sessionId;
    let text = "";
    try {
      if (sid) {
        try {
          const res = await fetch(`/api/terminal/log?session=${encodeURIComponent(sid)}`, { signal: controller.signal });
          if (res.ok) text = await res.text();
        } catch (cause) {
          if (controller.signal.aborted) throw cause;
          /* fall through to retained output */
        }
      }
      if (!text) text = await reader.readText(controller.signal);
      if (controller.signal.aborted) return;
      await copyTextToClipboard(text);
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (cause instanceof Error && cause.name === "AbortError") {
        toast.error("Terminal output changed while copying. Try again when it settles.");
      } else if (cause instanceof RangeError) {
        toast.error("Terminal output is too large to copy from scrollback.");
      } else {
        toast.error("Couldn't copy the terminal output.");
      }
      return;
    } finally {
      if (copyAbortRef.current === controller) copyAbortRef.current = null;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, [activeId, toast]);

  const saveActiveToNote = useCallback(async () => {
    const tab = activeId != null ? tabsRef.current.find((t) => t.id === activeId) : undefined;
    const reader = activeId != null ? readersRef.current.get(activeId) : undefined;
    if (!tab || !reader) return;
    const domSelection = window.getSelection();
    const stack = sessionStacksRef.current.get(tab.id);
    const selectedInTab = domSelection && stack?.contains(domSelection.anchorNode) && stack.contains(domSelection.focusNode)
      ? domSelection.toString() : "";
    const selection = resolveTerminalCopyText(reader.getSelection(), selectedInTab).trim();
    let body = selection || "";
    if (!body.trim()) {
      const sid = reader.sessionId();
      if (sid) {
        try {
          const res = await fetch(`/api/terminal/log?session=${encodeURIComponent(sid)}`);
          if (res.ok) body = lastTerminalBlock(await res.text());
        } catch {
          /* fall through */
        }
      }
      if (!body) {
        try {
          body = lastTerminalBlock(await reader.readText(new AbortController().signal));
        } catch {
          body = lastTerminalBlock(reader.getBuffer());
        }
      }
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
    const body = text;
    if (!body.trim()) {
      toast.error("Nothing to send.");
      return;
    }
    openAgentHandoff({
      title: tab?.repoName ? `Agent · ${tab.repoName}` : "Agent",
      context: body,
      kind: "agent",
      worktree: false,
      cwd: tab?.cwd,
      repoName: tab?.repoName,
    });
  }, [toast]);

  const runPromptCommand = useCallback(
    (tab: DockTab, command: string) => {
      const cmd = command.trim();
      if (!cmd) return;
      keepUserTerminal(tab.id);
      if (isDestructiveTerminalCommand(cmd)) {
        proposeTerminalRun({
          command: cmd,
          cwd: tab.cwd,
          kind: tab.kind ?? "shell",
          repoName: tab.repoName,
          summary: cmd,
          source: "ui",
        });
        return;
      }
      const reader = readersRef.current.get(tab.id);
      // Reconnecting sessions must not replay a command into an uncertain shell.
      if (!reader?.isReadyForInput()) {
        toast.error("Terminal is disconnected or not ready; command was not sent.");
        return;
      }
      if (reader?.write(formatTerminalInjectPayload(cmd))) {
        return;
      }
      toast.error("Command was not sent. Try again when the terminal is ready.");
    },
    [keepUserTerminal, toast],
  );

  const askPromptCommand = useCallback((tab: DockTab, text: string) => {
    if (!text.trim()) return;
    openAgentHandoff({ title: "Ask about this terminal", prompt: text, cwd: tab.cwd, repoName: tab.repoName, worktree: false });
  }, []);

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

  const setTabBusy = useCallback((tab: DockTab, busy: boolean) => {
    setTabs((prev) => prev.map((item) => item.id === tab.id && item.busy !== busy ? { ...item, busy } : item));
    const since = busySinceRef.current.get(tab.id);
    if (busy) {
      if (since == null) busySinceRef.current.set(tab.id, Date.now());
    } else {
      busySinceRef.current.delete(tab.id);
      if (shouldNotifyCommandFinished({
        startedAt: since,
        now: Date.now(),
        notifyEnabled: notifyDone,
        dockOpen: openRef.current,
        documentHidden: document.hidden,
        permission: notifyPermissionRef.current,
      })) void notify("DevHub terminal", `${tab.label} — command finished`);
    }
    if (!busy && !readersRef.current.get(tab.id)?.hasShellIntegration() && !injectExitPendingRef.current.has(tab.id)) completeCommandBlocks(tab.id);
    if (busy) clearAgentTabClose(tab.id);
    if (busy && !openRef.current) setUnread(true);
  }, [notifyDone, completeCommandBlocks, clearAgentTabClose]);

  const setTabCommandExit = useCallback((id: number, code: number) => {
    const quietSetup = pendingInjectRef.current.get(id)?.quietSetup;
    if (quietSetup) {
      quietSetup(code);
      return;
    }
    injectExitPendingRef.current.delete(id);
    completeCommandBlocks(id, code);
    if (agentCommandSentRef.current.delete(id)) {
      setTabs((prev) => prev.map((tab) => tab.id === id
        ? { ...tab, agentCommandPending: false, agentExitCode: code } : tab));
    }
    setTabs((prev) => prev.map((tab) => tab.id === id ? { ...tab, lastExitCode: code } : tab));
  }, [completeCommandBlocks]);

  const setTabExit = useCallback((id: number, code: number) => {
    injectExitPendingRef.current.delete(id);
    setTabs((prev) => prev.map((tab) => tab.id === id
      ? { ...tab, lastExitCode: code, ...(tab.agentRun ? { agentCommandPending: false, agentExitCode: code } : {}) } : tab));
    if (!openRef.current) setUnread(true);
  }, []);

  const setSessionStatus = useCallback((id: number, status: Status) => {
    if (status === "open") openedTabsRef.current.add(id);
    else if (openedTabsRef.current.has(id)) {
      const pending = pendingInjectRef.current.get(id);
      if (pending) {
        // A dropped connection cannot prove whether queued input arrived.
        pendingInjectRef.current.delete(id);
        flushingInjectRef.current.delete(id);
        setCommandBlocks((prev) => {
          const blocks = prev[id];
          if (!blocks) return prev;
          const kept = blocks.filter((block) => {
            const discard = block.pending && block.command === pending.command.trim();
            if (discard) blockMarkersRef.current.delete(block.id);
            return !discard;
          });
          return kept.length === blocks.length ? prev : { ...prev, [id]: kept };
        });
        setInjectQueuedId(null);
        const message = pending.quietEchoDisabled
          ? "Terminal disconnected; queued input was not resent. Echo may be disabled; run stty echo in the terminal."
          : "Terminal disconnected; queued input was not resent.";
        setInjectError(message);
        toast.error(message);
        if (pending.proposalId && pending.serverTracked) {
          patchServerProposal({ id: pending.proposalId, source: "ui" }, "failed", { finalCommand: pending.command, error: message });
        }
      }
    }
    setStatus(id, status);
  }, [patchServerProposal, setStatus, toast]);

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
  const showSessionActions = !!active;
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

  /** Drag the floating window by its title bar, like a real window. */
  const startPopoutMove = (event: React.MouseEvent) => {
    if (event.button !== 0) return;
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

  const startPopoutResize = (axis: ResizeAxis) => (event: React.MouseEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!rect) return;
    const start = { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
    const pointer = { x: event.clientX, y: event.clientY };
    let next = start;
    setResizing(true);
    startDragResize({
      cursor: RESIZE_CURSORS[axis],
      onMove: (move) => {
        next = resizeRect(
          start,
          axis,
          { x: move.clientX - pointer.x, y: move.clientY - pointer.y },
          { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight },
          { w: 360, h: 280 },
          { w: window.innerWidth - 32, h: window.innerHeight - 68 },
        );
        setPopoutSize({ w: next.w, h: next.h });
        setPopoutPos({ x: next.x, y: next.y });
      },
      onDone: () => {
        setResizing(false);
        writeTerminalPopoutSize({ w: next.w, h: next.h });
        writePopoutPos({ x: next.x, y: next.y });
      },
    });
  };
  const menuTab = termMenu.target != null ? tabs.find((t) => t.id === termMenu.target) : undefined;
  // Capture the selection before the context menu clears the native range.
  // eslint-disable-next-line react-hooks/refs
  const menuReader = termMenu.target != null ? readersRef.current.get(termMenu.target) : undefined;
  const menuSelection = menuCopyText;
  const termMenuGroups: ContextMenuGroup[] = [
    {
      id: "clip",
      label: "Clipboard",
      items: [
        {
          id: "copy",
          label: "Copy",
          icon: <ClipboardCopy size={12} aria-hidden />,
          disabled: !menuSelection,
          disabledReason: "No selection",
          onSelect: async () => {
            if (!menuSelection) return;
            try {
              await copyTextToClipboard(menuSelection);
            } catch {
              toast.error("Couldn't copy the selection.");
            }
          },
        },
        {
          id: "cut",
          label: "Cut",
          icon: <Scissors size={12} aria-hidden />,
          disabled: !menuHasTerminalSelection,
          disabledReason: "No terminal selection",
          onSelect: async () => {
            if (!menuSelection) return;
            try {
              await copyTextToClipboard(menuSelection);
              menuCutRef.current?.();
            } catch {
              toast.error("Couldn't copy the selection.");
            }
          },
        },
        {
          id: "paste",
          label: "Paste",
          icon: <ClipboardPaste size={12} aria-hidden />,
          onSelect: () => {
            void readTextFromClipboard().then((text) => {
              if (!text) return;
              menuReader?.paste(text);
            });
          },
        },
        ...(menuReader ? [{
          id: "select-all",
          label: "Select all",
          onSelect: async () => {
            if (!await menuReader.selectAll()) toast.error("Selection was cancelled or is too large. Try again when output settles.");
          },
        }] : []),
      ],
    },
    {
      id: "agent",
      label: "Agent",
      items: [
        {
          id: "send-agent",
          label: "Send to Agent",
          icon: <Sparkles size={12} aria-hidden />,
          onSelect: async () => {
            try {
              const text = menuSelection || lastTerminalBlock(await menuReader?.readText(new AbortController().signal) ?? "");
              sendTerminalToAgent(menuTab, text);
            } catch {
              toast.error("Couldn't read terminal output. Try again when it settles.");
            }
          },
        },
        {
          id: "send-block",
          label: "Send last block",
          icon: <Sparkles size={12} aria-hidden />,
          onSelect: async () => {
            try {
              const text = await menuReader?.readText(new AbortController().signal) ?? "";
              sendTerminalToAgent(menuTab, lastTerminalBlock(text));
            } catch {
              toast.error("Couldn't read terminal output. Try again when it settles.");
            }
          },
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
      data-dock-frame={frameAttr}
      data-resizing={resizing || undefined}
      data-moving={(windowed && movingPopout) || undefined}
      style={windowStyle ?? dockStyle}
      role="complementary"
      aria-label="Terminal"
    >
      {windowed ? (
        RESIZE_AXES.map((axis) => (
          <ResizeHandle
            key={axis}
            axis={axis}
            positioned
            onMouseDown={startPopoutResize(axis)}
          />
        ))
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
            if (denied.hostApproval) { void resolveHostApproval(denied, "deny"); return; }
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
            if (current.hostApproval) { void resolveHostApproval(current, "approve"); return; }
            const injectKind = injectKindForPropose({ kind: current.kind, source: current.source });
            const serverTracked = current.source === "mcp" || current.source === "ui";
            proposalScaffoldTabsRef.current.delete(current.id);
            setInjectError(null);
            const openDetail = {
              cwd: current.cwd,
              label: current.label,
              kind: injectKind,
              repoName: current.repoName,
              mode: current.mode,
            };
            const target = addTab(openDetail).id;
            setActiveId(target);
            if (current.mode) {
              setTabs((prev) =>
                prev.map((t) => (t.id === target ? { ...t, lastMode: current.mode } : t)),
              );
            }
            pendingInjectRef.current.set(target, {
              command,
              agentCommand: current.source === "mcp" || current.source === "agent-job",
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
                onClick={() => {
                  setActiveId(tab.id);
                }}
                // Middle-click closes, like a browser tab. Stopping mousedown also
                // keeps Windows/Linux from starting autoscroll.
                onMouseDown={(e) => {
                  if (e.button === 1) e.preventDefault();
                }}
                onAuxClick={(e) => {
                  if (e.button !== 1) return;
                  e.preventDefault();
                  closeTab(tab.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setActiveId(tab.id);
                  }
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
                    {tpl.id === "agent" ? <Sparkles size={12} aria-hidden /> : <SquareTerminal size={12} aria-hidden />}
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
          {active && (commandBlocks[active.id]?.length ?? 0) > 0 && (
            <HoverTip label={railHidden ? "Show agent commands" : "Hide agent commands"} pos="top-end">
              <button
                type="button"
                className="hub-icon-btn terminal-dock-btn"
                data-on={!railHidden || undefined}
                onClick={() => setRailHidden((hidden) => !hidden)}
                aria-pressed={!railHidden}
                aria-label="Toggle agent commands"
              >
                <History size={12} aria-hidden />
              </button>
            </HoverTip>
          )}
          <HoverTip
            label={
              autoRun
                ? "Auto-run: on — proposals run without asking (destructive ones still confirm)"
                : "Auto-run proposed commands without asking"
            }
            pos="top-end"
          >
            <button
              type="button"
              className="hub-icon-btn terminal-dock-btn"
              data-on={autoRun || undefined}
              onClick={toggleAutoRun}
              aria-pressed={autoRun}
              aria-label="Toggle auto-run for proposed commands"
            >
              <Play size={12} aria-hidden />
            </button>
          </HoverTip>
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
            onPopOut={() => {
              if (!active) return;
              setDockFrame(dockFrame === "popout" ? "dock" : "popout");
            }}
          />
          <HoverTip label={`Hide (${shortcut})`} pos="top-end">
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
      <div className="terminal-dock-body">
        {tabs.map((tab) => {
          const terminalPane = (
            <div
              ref={(element) => { sessionStacksRef.current.set(tab.id, element); }}
              className="terminal-session-stack"
              onContextMenu={(e) => {
                const reader = readersRef.current.get(tab.id);
                const selection = reader?.getSelection();
                setMenuHasTerminalSelection(!!selection);
                menuCutRef.current = reader?.prepareCut() ?? null;
                setMenuCopyText(resolveTerminalCopyText(selection, window.getSelection()?.toString()));
                e.preventDefault();
                e.stopPropagation();
                termMenu.openAt(e, tab.id);
              }}
            >
              <div className="terminal-session-grid">
                <WTermSession
                  cwd={tab.cwd}
                  attachSessionId={tab.sessionId}
                  active={open && tab.id === active?.id}
                  autoFocus={open && tab.id === active?.id && !proposal}
                  fontSize={fontSize ?? TERMINAL_FONT_SIZE_DEFAULT}
                  onStatus={(status) => setSessionStatus(tab.id, status)}
                  onSessionId={(sid) => setSessionId(tab.id, sid)}
                  onCwd={(cwd) => setTabs((prev) => prev.map((item) => item.id === tab.id && item.cwd !== cwd ? { ...item, cwd } : item))}
                  onBusy={(busy) => setTabBusy(tab, busy)}
                  onCommandExit={(code) => setTabCommandExit(tab.id, code)}
                  onExitCode={(code) => setTabExit(tab.id, code)}
                  onReattached={(reattached) => {
                    setTabs((prev) => prev.map((item) => item.id === tab.id ? { ...item, reattached } : item));
                  }}
                  onReadyForInput={() => flushPendingInject(tab.id)}
                  onUserInput={() => keepUserTerminal(tab.id)}
                  onCommandStart={() => markInjectedCommandStart(tab.id)}
                  onReader={(reader) => {
                    if (reader) {
                      readersRef.current.set(tab.id, reader);
                      flushPendingInject(tab.id);
                    } else {
                      readersRef.current.delete(tab.id);
                    }
                  }}
                  onOpenNew={() => addTab({ cwd: tab.cwd })}
                />
                {!railHidden && (
                  <TerminalBlockHistory
                    blocks={commandBlocks[tab.id] ?? []}
                    onCopy={(block) => {
                      void copyTextToClipboard(block.output.trim() || block.command);
                    }}
                    onSend={(block) => sendTerminalToAgent(tab, formatBlockForAgent(block))}
                    onRerun={(block) => runPromptCommand(tab, block.command)}
                    onExplain={(block) => explainFailedBlock(tab, block)}
                    onDismiss={() => setRailHidden(true)}
                  />
                )}
              </div>
            </div>
          );

          const visible = tab.id === active?.id;

          return (
            <div
              key={`${tab.id}-${tab.generation}`}
              style={{
                display: visible ? "block" : "none",
                height: "100%",
              }}
            >
              {terminalPane}
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
  const shortcut = useControlShortcutLabel()("`");
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
