"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FileText, FolderGit2, LayoutGrid, Plus, X } from "lucide-react";
import { workspaceTabChordFromEvent } from "@/lib/app-shortcuts";
import { PanelVisibilityContext } from "@/lib/hooks/panel-visibility";
import { workspaceTabHrefFromClick } from "@/lib/workspace-tab-links";
import type { SessionHistoryEntry } from "@/lib/session-history";
import {
  MAX_WORKSPACE_TABS,
  activateTab,
  canOpenTab,
  closeTab,
  cycleTab,
  jumpToIndex,
  loadWorkspaceTabs,
  navigateCurrent,
  normalizeHref,
  openBlank,
  openNew,
  publishActiveLabel,
  saveWorkspaceTabs,
  seedState,
  syncActiveHref,
  type WorkspaceTab,
  type WorkspaceTabKind,
  type WorkspaceTabsState,
} from "@/lib/workspace-tabs";

interface WorkspaceTabsApi {
  tabs: WorkspaceTab[];
  activeId: string;
  /** Active tab's breadcrumb trail — HubTopBar lives outside the panels. */
  history: SessionHistoryEntry[];
  openHref: (href: string, opts?: { newTab?: boolean }) => void;
  /** The "+" button: always a fresh tab, never a focus of an existing one. */
  newTab: (href?: string) => void;
  canOpen: boolean;
  activate: (id: string) => void;
  close: (id: string) => void;
  publishLabel: (href: string, label: string) => void;
}

const WorkspaceTabsContext = createContext<WorkspaceTabsApi | null>(null);

function currentHref(pathname: string, search: string): string {
  return search ? `${pathname}?${search}` : pathname;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

export function WorkspaceTabsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const href = currentHref(pathname, searchParams.toString());
  const hrefRef = useRef(href);
  const skipSyncRef = useRef(false);
  const pendingHrefRef = useRef<string | null>(null);
  const scrollById = useRef<Record<string, number>>({});

  const [state, setState] = useState<WorkspaceTabsState>(() => seedState(href));
  const stateRef = useRef(state);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    setState(navigateCurrent(loadWorkspaceTabs(hrefRef.current), hrefRef.current));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveWorkspaceTabs(state);
  }, [hydrated, state]);

  const saveScroll = useCallback((id: string) => {
    const main = document.getElementById("main-content");
    if (main) scrollById.current[id] = main.scrollTop;
  }, []);

  const restoreScroll = useCallback((id: string) => {
    const y = scrollById.current[id];
    if (y == null) return;
    requestAnimationFrame(() => {
      const main = document.getElementById("main-content");
      if (main) main.scrollTop = y;
    });
  }, []);

  const apply = useCallback(
    (next: WorkspaceTabsState) => {
      const prevActive = stateRef.current.activeId;
      if (prevActive !== next.activeId) saveScroll(prevActive);
      const tab = next.tabs.find((t) => t.id === next.activeId);
      setState(next);
      if (tab && normalizeHref(tab.href) !== normalizeHref(hrefRef.current)) {
        hrefRef.current = tab.href;
        skipSyncRef.current = true;
        pendingHrefRef.current = tab.href;
        // Inactive panels unmount, so {children} must become this route.
        router.push(tab.href);
        restoreScroll(next.activeId);
      }
    },
    [restoreScroll, router, saveScroll],
  );

  useEffect(() => {
    if (skipSyncRef.current) {
      if (
        pendingHrefRef.current &&
        normalizeHref(href) !== normalizeHref(pendingHrefRef.current)
      ) {
        return;
      }
      skipSyncRef.current = false;
      pendingHrefRef.current = null;
      hrefRef.current = href;
      return;
    }
    if (normalizeHref(hrefRef.current) === normalizeHref(href)) return;
    hrefRef.current = href;
    setState((prev) => syncActiveHref(prev, href));
  }, [href]);

  const openHref = useCallback(
    (nextHref: string, opts?: { newTab?: boolean }) => {
      const current = stateRef.current;
      apply(opts?.newTab ? openNew(current, nextHref) : navigateCurrent(current, nextHref));
    },
    [apply],
  );

  const newTab = useCallback(
    (nextHref?: string) => {
      apply(openBlank(stateRef.current, nextHref));
    },
    [apply],
  );

  const activate = useCallback(
    (id: string) => {
      apply(activateTab(stateRef.current, id));
    },
    [apply],
  );

  const close = useCallback(
    (id: string) => {
      apply(closeTab(stateRef.current, id));
    },
    [apply],
  );

  const publishLabel = useCallback((nextHref: string, label: string) => {
    setState((prev) => publishActiveLabel(prev, nextHref, label));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (document.querySelector("dialog[open]")) return;
      if (document.querySelector('[aria-label="Command palette"]')) return;
      const chord = workspaceTabChordFromEvent(e);
      if (!chord) return;
      e.preventDefault();
      if (chord.type === "jump") apply(jumpToIndex(stateRef.current, chord.index));
      else apply(cycleTab(stateRef.current, chord.dir));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [apply]);

  /**
   * Shift / ⌘ / middle-click on an in-app link opens a workspace tab.
   *
   * Capture phase, because Next's `<Link>` deliberately passes modified clicks
   * through to the browser — by the time a bubbled handler ran, the browser had
   * already been told to open a window. Capture also lets one listener cover
   * every internal link in the app instead of each row wiring its own.
   */
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const nextHref = workspaceTabHrefFromClick(event, window.location.origin);
      if (!nextHref) return;
      event.preventDefault();
      event.stopPropagation();
      openHref(nextHref, { newTab: true });
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("auxclick", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("auxclick", onClick, true);
    };
  }, [openHref]);

  const api = useMemo<WorkspaceTabsApi>(
    () => {
      const activeHistory =
        state.tabs.find((t) => t.id === state.activeId)?.history ?? [];
      return {
        tabs: state.tabs,
        activeId: state.activeId,
        history: activeHistory,
        openHref,
        newTab,
        canOpen: canOpenTab(state),
        activate,
        close,
        publishLabel,
      };
    },
    [state, openHref, newTab, activate, close, publishLabel],
  );

  return (
    <WorkspaceTabsContext.Provider value={api}>{children}</WorkspaceTabsContext.Provider>
  );
}

export function useWorkspaceTabs(): WorkspaceTabsApi {
  const ctx = useContext(WorkspaceTabsContext);
  if (!ctx) throw new Error("useWorkspaceTabs must be used inside WorkspaceTabsProvider");
  return ctx;
}

/**
 * Renders only the active tab's page. Inactive trees unmount so they cannot
 * follow `usePathname` / `{children}` when the URL changes (keep-alive leaked
 * notes, repos, and docs across tabs).
 *
 * Switching tabs `router.push`es that tab's href so the remounted page reads
 * the right URL. Notes reload from disk; autosave already covers in-flight edits.
 */
export function WorkspaceTabPanels({ children }: { children: ReactNode }) {
  const ctx = useContext(WorkspaceTabsContext);
  if (!ctx) return children;

  return (
    <div className="workspace-tab-panels">
      <div
        key={ctx.activeId}
        data-workspace-tab-panel={ctx.activeId}
        role="tabpanel"
        className="workspace-tab-panel"
      >
        <PanelVisibilityContext.Provider value={true}>{children}</PanelVisibilityContext.Provider>
      </div>
    </div>
  );
}

function TabKindIcon({ kind }: { kind: WorkspaceTabKind }) {
  const props = { size: 12, "aria-hidden": true as const };
  if (kind === "repo") return <FolderGit2 {...props} />;
  if (kind === "note") return <FileText {...props} />;
  return <LayoutGrid {...props} />;
}

export function WorkspaceTabStrip() {
  const ctx = useContext(WorkspaceTabsContext);
  const pathname = usePathname();
  const stripRef = useRef<HTMLDivElement>(null);

  /**
   * Arrow keys move between tabs, Home/End jump to the ends.
   *
   * These are `<div role="tab">`, so none of it comes for free — before this
   * the strip was unreachable by keyboard entirely. The ⌘1-9 / Ctrl+Tab chords
   * worked, but they are undiscoverable and do nothing for a screen reader
   * walking the tablist.
   */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, id: string, index: number) => {
    if (!ctx) return;
    const last = ctx.tabs.length - 1;
    const to =
      event.key === "ArrowRight"
        ? Math.min(index + 1, last)
        : event.key === "ArrowLeft"
          ? Math.max(index - 1, 0)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;

    if (to !== null) {
      event.preventDefault();
      const next = ctx.tabs[to];
      if (!next) return;
      ctx.activate(next.id);
      // Follow-the-focus, matching how a click behaves.
      stripRef.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(next.id)}"]`)?.focus();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      ctx.activate(id);
    }
  };

  if (!ctx) {
    return <div className="workspace-tabs" aria-hidden />;
  }
  const { tabs, activeId, activate, close, newTab, canOpen } = ctx;
  const canClose = tabs.length > 1;
  // Only where the confusion actually exists: /repos renders its own tablist of
  // repo-group filters right below this one. Everywhere else the hint was
  // permanent chrome explaining something that wasn't on screen.
  const showGroupHint = pathname === "/repos";

  return (
    <div className="workspace-tabs">
      {showGroupHint && (
        <p className="workspace-tabs-hint">Workspace tabs — repo group filters are below</p>
      )}
      <div className="workspace-tabs-bar">
        {/*
          The tablist wraps only the tabs. The hint and the "+" button used to
          sit inside it, and a tablist that owns non-tab children reports the
          wrong tab count and position to assistive tech.
        */}
        <div
          className="workspace-tabs-scroll"
          role="tablist"
          aria-label="Workspace tabs"
          ref={stripRef}
        >
          {tabs.map((tab, i) => {
            const active = tab.id === activeId;
            return (
              <div
                key={tab.id}
                role="tab"
                data-tab-id={tab.id}
                aria-selected={active}
                // Roving tabindex: one stop for the whole strip, then arrows.
                tabIndex={active ? 0 : -1}
                data-active={active || undefined}
                className="workspace-tab"
                onClick={() => activate(tab.id)}
                onKeyDown={(e) => onKeyDown(e, tab.id, i)}
                onAuxClick={(e) => {
                  if (e.button !== 1 || !canClose) return;
                  e.preventDefault();
                  e.stopPropagation();
                  close(tab.id);
                }}
              >
                <span className="workspace-tab-icon">
                  <TabKindIcon kind={tab.kind} />
                </span>
                <span className="workspace-tab-title">
                  {tab.title}
                  <span className="sr-only">{i < 9 ? ` (⌘${i + 1})` : ""}</span>
                </span>
                {canClose ? (
                  <button
                    type="button"
                    className="workspace-tab-close"
                    tabIndex={active ? 0 : -1}
                    aria-label={`Close ${tab.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      close(tab.id);
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <X size={11} aria-hidden />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="workspace-tab-new"
          onClick={() => newTab()}
          disabled={!canOpen}
          aria-label="New tab"
          title={canOpen ? "New tab" : `Tab limit reached (${MAX_WORKSPACE_TABS})`}
        >
          <Plus size={13} aria-hidden />
        </button>
      </div>
    </div>
  );
}
