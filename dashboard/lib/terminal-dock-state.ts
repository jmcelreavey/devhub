/**
 * Persistable terminal-dock tab metadata + expand policy.
 *
 * Tabs live in React state; a dashboard remount (HMR / webview reload) would
 * otherwise wipe them even when the PTY peer is still alive. sessionStorage
 * keeps the tab list + session ids so the UI can reattach.
 */

import {
  parseTerminalSessionKind,
  type TerminalSessionKind,
} from "@/lib/terminal-meta";

export const TERMINAL_DOCK_STORAGE_KEY = "devhub:terminal-dock.v1";

export interface PersistedDockTab {
  id: number;
  cwd?: string;
  label: string;
  /** Live PTY session id when known — used to reattach after a UI remount. */
  sessionId?: string | null;
  kind?: TerminalSessionKind;
  repoName?: string;
}

export interface PersistedDockState {
  tabs: PersistedDockTab[];
  activeId: number | null;
  /** Next tab id counter so restored tabs don't collide with new ones. */
  nextId: number;
  open: boolean;
  /** User hid the dock; suppress auto-expand until they open it again. */
  userCollapsed: boolean;
}

export function shouldExpandOnTerminalOpen(opts: {
  userCollapsed: boolean;
  /** localStorage override for people who want the old always-expand behaviour. */
  alwaysExpand?: boolean;
}): boolean {
  if (opts.alwaysExpand) return true;
  return !opts.userCollapsed;
}

export function parsePersistedDockState(raw: string | null): PersistedDockState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedDockState>;
    if (!Array.isArray(parsed.tabs)) return null;
    const tabs: PersistedDockTab[] = [];
    for (const tab of parsed.tabs) {
      if (!tab || typeof tab !== "object") continue;
      const id = (tab as PersistedDockTab).id;
      const label = (tab as PersistedDockTab).label;
      if (typeof id !== "number" || !Number.isFinite(id) || typeof label !== "string") continue;
      const cwd = (tab as PersistedDockTab).cwd;
      const sessionId = (tab as PersistedDockTab).sessionId;
      const kind = parseTerminalSessionKind((tab as PersistedDockTab).kind);
      const repoName = (tab as PersistedDockTab).repoName;
      tabs.push({
        id,
        label,
        ...(typeof cwd === "string" ? { cwd } : {}),
        ...(typeof sessionId === "string" || sessionId === null ? { sessionId } : {}),
        ...(kind ? { kind } : {}),
        ...(typeof repoName === "string" ? { repoName } : {}),
      });
    }
    if (tabs.length === 0) return null;
    const activeId = typeof parsed.activeId === "number" ? parsed.activeId : tabs[0]?.id ?? null;
    const nextId =
      typeof parsed.nextId === "number" && parsed.nextId >= 0
        ? parsed.nextId
        : Math.max(...tabs.map((t) => t.id), 0);
    return {
      tabs,
      activeId: tabs.some((t) => t.id === activeId) ? activeId : tabs[0]?.id ?? null,
      nextId,
      open: parsed.open === true,
      userCollapsed: parsed.userCollapsed === true,
    };
  } catch {
    return null;
  }
}

export function readPersistedDockState(): PersistedDockState | null {
  if (typeof window === "undefined") return null;
  try {
    return parsePersistedDockState(sessionStorage.getItem(TERMINAL_DOCK_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writePersistedDockState(state: PersistedDockState): void {
  if (typeof window === "undefined") return;
  try {
    if (state.tabs.length === 0) {
      sessionStorage.removeItem(TERMINAL_DOCK_STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(TERMINAL_DOCK_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private mode / quota */
  }
}

/**
 * Dock frame — how the terminal dock is presented.
 *
 * - `dock`    bottom sheet at the user's chosen height (the default)
 * - `popout`  detached floating window, resizable from its edges
 * - `split`   two panes side by side
 *
 * There is deliberately no maximise/minimise: both were one-way trips with no
 * obvious way back, and dragging an edge covers the same ground reversibly.
 */
export const DOCK_FRAMES = ["dock", "popout", "split"] as const;

export type DockFrame = (typeof DOCK_FRAMES)[number];

export function parseDockFrame(value: unknown): DockFrame | null {
  if (typeof value !== "string") return null;
  return (DOCK_FRAMES as readonly string[]).includes(value) ? (value as DockFrame) : null;
}

/** Dock height is a durable preference, so localStorage rather than session. */
export const TERMINAL_DOCK_HEIGHT_KEY = "devhub:terminal-dock-height";

/** Below this the tab bar and prompt bar crowd out the shell. */
export const DOCK_MIN_HEIGHT = 220;
/** Leave the top bar reachable so the dock can never trap the user. */
export const DOCK_TOP_GUTTER = 48;

export function clampDockHeight(height: number, viewportHeight: number): number {
  const max = Math.max(DOCK_MIN_HEIGHT, viewportHeight - DOCK_TOP_GUTTER);
  return Math.round(Math.min(Math.max(height, DOCK_MIN_HEIGHT), max));
}

export function readDockHeight(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(TERMINAL_DOCK_HEIGHT_KEY);
    if (!raw) return null;
    const height = Number.parseInt(raw, 10);
    if (!Number.isFinite(height) || height < DOCK_MIN_HEIGHT) return null;
    return clampDockHeight(height, window.innerHeight);
  } catch {
    return null;
  }
}

export function writeDockHeight(height: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      TERMINAL_DOCK_HEIGHT_KEY,
      String(clampDockHeight(height, window.innerHeight)),
    );
  } catch {
    /* private mode / quota */
  }
}

/** Where a popped-out pane sits. Null means "use the default corner". */
export interface PopoutPos {
  x: number;
  y: number;
}

export const TERMINAL_POPOUT_POS_KEY = "devhub:terminal-popout-pos";

/** Keep a sliver on screen so a window can always be grabbed back. */
export const POPOUT_KEEP_VISIBLE = 96;

export function clampPopoutPos(
  pos: PopoutPos,
  size: { w: number; h: number },
  viewport: { w: number; h: number },
): PopoutPos {
  return {
    x: Math.round(
      Math.min(Math.max(pos.x, POPOUT_KEEP_VISIBLE - size.w), viewport.w - POPOUT_KEEP_VISIBLE),
    ),
    // Never above the top bar, and never dragged fully past the bottom.
    y: Math.round(Math.min(Math.max(pos.y, 0), Math.max(0, viewport.h - POPOUT_KEEP_VISIBLE))),
  };
}

export function readPopoutPos(): PopoutPos | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(TERMINAL_POPOUT_POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PopoutPos>;
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
    return { x: parsed.x as number, y: parsed.y as number };
  } catch {
    return null;
  }
}

export function writePopoutPos(pos: PopoutPos): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TERMINAL_POPOUT_POS_KEY, JSON.stringify(pos));
  } catch {
    /* private mode / quota */
  }
}

/** Optional localStorage pref — restore the old "always pop open" behaviour. */
export const TERMINAL_ALWAYS_EXPAND_KEY = "devhub:terminal-always-expand";

export function readAlwaysExpandPref(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(TERMINAL_ALWAYS_EXPAND_KEY) === "1";
  } catch {
    return false;
  }
}

/** Open-detail shape used by TerminalDock tab reuse. */
export interface TerminalOpenPickDetail {
  cwd?: string;
  label?: string;
  command?: string;
  kind?: PersistedDockTab["kind"];
  repoName?: string;
  preferAgentTab?: boolean;
  /** When last open was interactive agent TUI, skip reuse. */
  mode?: "oneshot" | "interactive";
}

export interface TerminalOpenPickTab {
  id: number;
  cwd?: string;
  label: string;
  kind?: PersistedDockTab["kind"];
  repoName?: string;
  status?: string;
  busy?: boolean;
  /** Last launch mode — interactive agent tabs are not reused for inject. */
  lastMode?: "oneshot" | "interactive";
}

function isAgentLike(kind: PersistedDockTab["kind"] | undefined): boolean {
  return kind === "agent" || kind === "review";
}

function isDedicatedKind(kind: PersistedDockTab["kind"] | undefined): boolean {
  return kind === "upstart" || kind === "devserver" || kind === "capture";
}

/**
 * Pick an existing tab for an open/propose request.
 * PreferAgent never reuses shell/devserver tabs by cwd — that stomped
 * long-running servers when agent jobs confirmed into the active dedicated tab.
 */
export function findTabForOpen(
  tabs: TerminalOpenPickTab[],
  detail: TerminalOpenPickDetail | undefined,
): TerminalOpenPickTab | null {
  if (!detail) return null;
  const preferAgent =
    detail.preferAgentTab === true ||
    (detail.preferAgentTab !== false && isAgentLike(detail.kind));

  if (preferAgent) {
    const dedicated = isDedicatedKind(detail.kind);
    const existing = tabs.find((t) => {
      if (t.status === "closed" || t.busy) return false;
      // Don't type into a quiet interactive agent REPL.
      if (t.lastMode === "interactive") return false;
      if (dedicated) {
        if (t.kind !== detail.kind) return false;
      } else if (!isAgentLike(t.kind)) {
        return false;
      }
      if (detail.cwd && t.cwd !== detail.cwd) return false;
      if (detail.repoName && t.repoName !== detail.repoName) return false;
      return true;
    });
    return existing ?? null;
  }

  // Dedicated kinds (devserver, upstart): reuse so we don't duel on a port.
  if (detail.command && isDedicatedKind(detail.kind)) {
    const existing = tabs.find((t) => {
      if (t.status === "closed" || t.busy) return false;
      if (t.kind !== detail.kind) return false;
      if (detail.cwd && t.cwd !== detail.cwd) return false;
      if (detail.label && t.label !== detail.label) return false;
      return true;
    });
    return existing ?? null;
  }

  // Non-agent with a fresh command: never reuse (except dedicated above).
  if (detail.command) return null;
  if (!detail.cwd && !detail.label && !detail.repoName) return null;
  const matches = (t: TerminalOpenPickTab) => {
    if (detail.cwd && t.cwd === detail.cwd) return true;
    if (detail.repoName && t.repoName === detail.repoName) return true;
    if (detail.label && t.label === detail.label) return true;
    return false;
  };
  // Prefer same kind so "Open in terminal" doesn't steal an Agent/devserver tab.
  if (detail.kind) {
    const sameKind = tabs.find((t) => t.kind === detail.kind && matches(t));
    if (sameKind) return sameKind;
  }
  return tabs.find((t) => matches(t)) ?? null;
}

/** Truncate giant CLI prompts for the confirm chip preview. */
export function previewTerminalCommand(command: string, max = 280): string {
  const trimmed = command.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

/**
 * Default chip text: friendly summary/label/reason, not the raw CLI.
 * Full command stays available via tooltip / Advanced edit.
 */
export function formatProposePreview(
  proposal: {
    command: string;
    summary?: string;
    label?: string;
    reason?: string;
  },
  max = 280,
): string {
  const friendly =
    proposal.summary?.trim() || proposal.label?.trim() || proposal.reason?.trim();
  if (friendly) {
    return friendly.length <= max ? friendly : `${friendly.slice(0, max)}…`;
  }
  return previewTerminalCommand(proposal.command, max);
}

// ---------------------------------------------------------------------------
// Decisions that used to live inline inside TerminalDock's effects. They are
// pure, they each encode a judgement call worth stating once, and neither was
// reachable from a test while it sat in a 2,300-line component.
// ---------------------------------------------------------------------------

/** Only notify about commands that ran at least this long. */
export const NOTIFY_MIN_MS = 10_000;

export type NotificationPermissionState = "granted" | "denied" | "default" | "unsupported";

/**
 * Should a finished command raise a desktop notification?
 *
 * The point is to catch the case where you started something slow and went to
 * do something else. Every clause is there to avoid notifying someone about a
 * thing they are already looking at: a quick command, a dock that is open and
 * on screen, or a browser that never granted permission.
 */
export function shouldNotifyCommandFinished(opts: {
  /** When the command went busy, or undefined if we never saw it start. */
  startedAt: number | undefined;
  now: number;
  notifyEnabled: boolean;
  /** The dock is expanded on screen. */
  dockOpen: boolean;
  documentHidden: boolean;
  permission: NotificationPermissionState;
  minDurationMs?: number;
}): boolean {
  const { startedAt, now, notifyEnabled, dockOpen, documentHidden, permission } = opts;
  if (!startedAt) return false;
  if (!notifyEnabled) return false;
  if (permission !== "granted") return false;
  if (now - startedAt < (opts.minDurationMs ?? NOTIFY_MIN_MS)) return false;
  // Watching it happen is its own notification.
  if (dockOpen && !documentHidden) return false;
  return true;
}

/**
 * A pending block that outlives this while output is actively streaming is a
 * foreground process (`npm run dev`) the blocks pane cannot stream.
 */
export const LONG_RUNNING_MS = 3_000;

/** An unproven shell gets longer, so a slow first prompt is not mistaken for one. */
export const UNPROVEN_SHELL_GRACE_MS = 15_000;

/**
 * Should the blocks view drop back to the raw grid?
 *
 * A quiet pending block is just a shell warming up; flipping there would yank
 * blocks-mode users to raw on every fresh tab. So the shell has to be actively
 * producing output, and it has to have either completed a command before (it
 * is a real shell, so this really is a long-running foreground process) or been
 * pending long enough that nothing else explains it.
 */
export function shouldFallBackToRawView(opts: {
  blocks: { pending?: boolean; startedAt: number }[];
  now: number;
  /** The reader says output is still streaming. */
  busy: boolean;
  longRunningMs?: number;
  unprovenGraceMs?: number;
}): boolean {
  if (!opts.busy) return false;
  const pending = opts.blocks.find((b) => b.pending);
  if (!pending) return false;
  const age = opts.now - pending.startedAt;
  if (age <= (opts.longRunningMs ?? LONG_RUNNING_MS)) return false;
  const provenShell = opts.blocks.some((b) => !b.pending);
  return provenShell || age > (opts.unprovenGraceMs ?? UNPROVEN_SHELL_GRACE_MS);
}
