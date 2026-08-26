"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FileText, FolderGit2, LayoutGrid, X } from "lucide-react";
import { workspaceTabChordFromEvent } from "@/lib/app-shortcuts";
import {
  activateTab,
  closeTab,
  cycleTab,
  jumpToIndex,
  loadWorkspaceTabs,
  navigateCurrent,
  normalizeHref,
  openNew,
  saveWorkspaceTabs,
  seedState,
  type WorkspaceTab,
  type WorkspaceTabKind,
  type WorkspaceTabsState,
} from "@/lib/workspace-tabs";

interface WorkspaceTabsApi {
  tabs: WorkspaceTab[];
  activeId: string;
  openHref: (href: string, opts?: { newTab?: boolean }) => void;
  activate: (id: string) => void;
  close: (id: string) => void;
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
        skipSyncRef.current = true;
        hrefRef.current = tab.href;
        router.push(tab.href);
        restoreScroll(next.activeId);
      }
    },
    [restoreScroll, router, saveScroll],
  );

  useEffect(() => {
    if (skipSyncRef.current) {
      skipSyncRef.current = false;
      hrefRef.current = href;
      return;
    }
    if (normalizeHref(hrefRef.current) === normalizeHref(href)) return;
    hrefRef.current = href;
    setState((prev) => navigateCurrent(prev, href));
  }, [href]);

  const openHref = useCallback(
    (nextHref: string, opts?: { newTab?: boolean }) => {
      const current = stateRef.current;
      apply(opts?.newTab ? openNew(current, nextHref) : navigateCurrent(current, nextHref));
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

  const api = useMemo<WorkspaceTabsApi>(
    () => ({ tabs: state.tabs, activeId: state.activeId, openHref, activate, close }),
    [state.tabs, state.activeId, openHref, activate, close],
  );

  return <WorkspaceTabsContext.Provider value={api}>{children}</WorkspaceTabsContext.Provider>;
}

export function useWorkspaceTabs(): WorkspaceTabsApi {
  const ctx = useContext(WorkspaceTabsContext);
  if (!ctx) throw new Error("useWorkspaceTabs must be used inside WorkspaceTabsProvider");
  return ctx;
}

function TabKindIcon({ kind }: { kind: WorkspaceTabKind }) {
  const props = { size: 12, "aria-hidden": true as const };
  if (kind === "repo") return <FolderGit2 {...props} />;
  if (kind === "note") return <FileText {...props} />;
  return <LayoutGrid {...props} />;
}

export function WorkspaceTabStrip() {
  const ctx = useContext(WorkspaceTabsContext);
  if (!ctx) {
    return <div className="workspace-tabs" aria-hidden />;
  }
  const { tabs, activeId, activate, close } = ctx;
  const canClose = tabs.length > 1;

  return (
    <div className="workspace-tabs" role="tablist" aria-label="Workspace tabs">
      <div className="workspace-tabs-scroll">
        {tabs.map((tab, i) => {
          const active = tab.id === activeId;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              data-active={active || undefined}
              className="workspace-tab"
              onClick={() => activate(tab.id)}
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
                  aria-label={`Close ${tab.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    close(tab.id);
                  }}
                >
                  <X size={11} aria-hidden />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
