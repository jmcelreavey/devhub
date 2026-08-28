import { ALL_NAV_DESTINATIONS } from "@/lib/nav";
import {
  appendSessionHistory,
  type SessionHistoryEntry,
} from "@/lib/session-history";

export type WorkspaceTabKind = "repo" | "nav" | "note" | "other";

export interface WorkspaceTab {
  id: string;
  href: string;
  title: string;
  kind: WorkspaceTabKind;
  /** In-tab trail for HubTopBar. Optional on disk; hydrated on read. */
  history: SessionHistoryEntry[];
}

export interface WorkspaceTabsState {
  tabs: WorkspaceTab[];
  activeId: string;
}

export const WORKSPACE_TABS_STORAGE_KEY = "devhub.workspace-tabs";
const STORAGE_VERSION = 1;

/**
 * Hard cap on open tabs.
 *
 * Storage already truncated to this on read, so anything above it was a tab
 * that silently disappeared on the next reload. Enforce it when opening too.
 */
export const MAX_WORKSPACE_TABS = 24;

/** Where the "+" button lands — Today, the same place a cold start opens. */
export const NEW_TAB_HREF = "/";

let idSeq = 0;

export function createTabId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  idSeq += 1;
  return `tab-${idSeq}`;
}

export function normalizeHref(href: string): string {
  if (!href) return "/";
  const qIndex = href.indexOf("?");
  const path = qIndex === -1 ? href : href.slice(0, qIndex);
  const query = qIndex === -1 ? "" : href.slice(qIndex + 1);
  const trimmed = path !== "/" ? path.replace(/\/+$/, "") : "/";
  return query ? `${trimmed}?${query}` : trimmed;
}

export function describeHref(href: string): { title: string; kind: WorkspaceTabKind } {
  const n = normalizeHref(href);
  const path = n.split("?")[0] ?? n;
  const repo = path.match(/^\/repos\/([^/]+)$/);
  if (repo?.[1]) {
    try {
      return { title: decodeURIComponent(repo[1]), kind: "repo" };
    } catch {
      return { title: repo[1], kind: "repo" };
    }
  }
  if (path.startsWith("/notes/") && path !== "/notes") {
    const last = path.split("/").pop() ?? "Note";
    try {
      return { title: decodeURIComponent(last), kind: "note" };
    } catch {
      return { title: last, kind: "note" };
    }
  }
  const matches = ALL_NAV_DESTINATIONS.filter((item) =>
    item.href === "/" ? path === "/" : path === item.href || path.startsWith(`${item.href}/`),
  ).sort((a, b) => b.href.length - a.href.length);
  if (matches[0]) return { title: matches[0].label, kind: "nav" };
  const last = path.split("/").filter(Boolean).pop();
  if (!last) return { title: "Tab", kind: "other" };
  try {
    return { title: decodeURIComponent(last), kind: "other" };
  } catch {
    return { title: last, kind: "other" };
  }
}

function seedHistory(href: string, title: string, ts = Date.now()): SessionHistoryEntry[] {
  return [{ href, label: title, ts }];
}

export function createTab(href: string, id: string = createTabId()): WorkspaceTab {
  const n = normalizeHref(href);
  const { title, kind } = describeHref(n);
  return { id, href: n, title, kind, history: seedHistory(n, title) };
}

export function seedState(href: string): WorkspaceTabsState {
  const tab = createTab(href);
  return { tabs: [tab], activeId: tab.id };
}

function findByHref(state: WorkspaceTabsState, href: string): WorkspaceTab | undefined {
  const n = normalizeHref(href);
  return state.tabs.find((t) => t.href === n);
}

/**
 * URL changed in the active tab (in-tab nav / href-sync). Never steals a
 * neighbour that happens to already show this href — that's what made
 * shift-click rewrite the tab to the right.
 */
export function syncActiveHref(state: WorkspaceTabsState, href: string): WorkspaceTabsState {
  const n = normalizeHref(href);
  const active = state.tabs.find((t) => t.id === state.activeId) ?? state.tabs[0];
  if (!active) return seedState(n);
  if (active.href === n) return state;
  const { title, kind } = describeHref(n);
  const history = appendSessionHistory(active.history ?? [], {
    href: n,
    label: title,
    ts: Date.now(),
  });
  const last = history.at(-1);
  const updated: WorkspaceTab = {
    id: active.id,
    href: n,
    title: last?.label ?? title,
    kind,
    history,
  };
  return {
    tabs: state.tabs.map((t) => (t.id === active.id ? updated : t)),
    activeId: active.id,
  };
}

/** Enter in the palette: reuse a tab with this href, otherwise replace the current one. */
export function navigateCurrent(state: WorkspaceTabsState, href: string): WorkspaceTabsState {
  const n = normalizeHref(href);
  const existing = findByHref(state, n);
  if (existing) return { tabs: state.tabs, activeId: existing.id };
  return syncActiveHref(state, n);
}

/** Shift+Enter / Shift+click: always a new tab, inserted to the right of active. */
export function openNew(state: WorkspaceTabsState, href: string): WorkspaceTabsState {
  return insertAfterActive(state, normalizeHref(href));
}

/**
 * The "+" button: always a fresh tab, even when one already shows this href.
 *
 * Deliberately not `openNew` — that inserts beside the active tab, while "+"
 * appends at the end like a browser.
 */
export function openBlank(
  state: WorkspaceTabsState,
  href: string = NEW_TAB_HREF,
): WorkspaceTabsState {
  return appendTab(state, normalizeHref(href));
}

function appendTab(state: WorkspaceTabsState, normalizedHref: string): WorkspaceTabsState {
  if (state.tabs.length >= MAX_WORKSPACE_TABS) return state;
  const tab = createTab(normalizedHref);
  return { tabs: [...state.tabs, tab], activeId: tab.id };
}

function insertAfterActive(state: WorkspaceTabsState, normalizedHref: string): WorkspaceTabsState {
  if (state.tabs.length >= MAX_WORKSPACE_TABS) return state;
  const tab = createTab(normalizedHref);
  const idx = state.tabs.findIndex((t) => t.id === state.activeId);
  const at = idx === -1 ? state.tabs.length : idx + 1;
  return {
    tabs: [...state.tabs.slice(0, at), tab, ...state.tabs.slice(at)],
    activeId: tab.id,
  };
}

/** False when the strip is full — the "+" button disables rather than no-oping. */
export function canOpenTab(state: WorkspaceTabsState): boolean {
  return state.tabs.length < MAX_WORKSPACE_TABS;
}

export function applyPaletteNavigation(
  state: WorkspaceTabsState,
  href: string,
  newTab: boolean,
): WorkspaceTabsState {
  return newTab ? openNew(state, href) : navigateCurrent(state, href);
}

/** Publish a loaded display title onto the active tab and matching crumb. */
export function publishActiveLabel(
  state: WorkspaceTabsState,
  href: string,
  label: string,
): WorkspaceTabsState {
  const trimmed = label.trim();
  if (!trimmed) return state;
  const n = normalizeHref(href);
  const active = state.tabs.find((t) => t.id === state.activeId);
  if (!active) return state;
  const title = active.href === n ? trimmed : active.title;
  const history = (active.history ?? []).map((entry) =>
    normalizeHref(entry.href) === n && entry.label !== trimmed ? { ...entry, label: trimmed } : entry,
  );
  const historyChanged = history.some((entry, i) => entry !== (active.history ?? [])[i]);
  if (title === active.title && !historyChanged) return state;
  return {
    tabs: state.tabs.map((t) => (t.id === active.id ? { ...active, title, history } : t)),
    activeId: state.activeId,
  };
}

export function updateTabTitle(
  state: WorkspaceTabsState,
  id: string,
  title: string,
): WorkspaceTabsState {
  const trimmed = title.trim();
  if (!trimmed) return state;
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab || tab.title === trimmed) return state;
  return {
    tabs: state.tabs.map((t) => (t.id === id ? { ...t, title: trimmed } : t)),
    activeId: state.activeId,
  };
}

/** Never closes the last tab. Activates a neighbour when the active tab goes. */
export function closeTab(state: WorkspaceTabsState, id: string): WorkspaceTabsState {
  if (state.tabs.length <= 1) return state;
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx === -1) return state;
  const tabs = state.tabs.filter((t) => t.id !== id);
  if (state.activeId !== id) return { tabs, activeId: state.activeId };
  const next = tabs[Math.min(idx, tabs.length - 1)]!;
  return { tabs, activeId: next.id };
}

export function activateTab(state: WorkspaceTabsState, id: string): WorkspaceTabsState {
  if (!state.tabs.some((t) => t.id === id)) return state;
  return { tabs: state.tabs, activeId: id };
}

export function cycleTab(state: WorkspaceTabsState, dir: 1 | -1): WorkspaceTabsState {
  if (state.tabs.length === 0) return state;
  const i = state.tabs.findIndex((t) => t.id === state.activeId);
  const next = state.tabs[(i + dir + state.tabs.length) % state.tabs.length]!;
  return { tabs: state.tabs, activeId: next.id };
}

/** 1-based index, ⌘1 → first tab. */
export function jumpToIndex(state: WorkspaceTabsState, index1: number): WorkspaceTabsState {
  const tab = state.tabs[index1 - 1];
  return tab ? { tabs: state.tabs, activeId: tab.id } : state;
}

interface StoredV1 {
  v: 1;
  tabs: WorkspaceTab[];
  activeId: string;
}

function isHistoryEntry(value: unknown): value is SessionHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const e = value as SessionHistoryEntry;
  return typeof e.href === "string" && typeof e.label === "string" && typeof e.ts === "number";
}

function parseHistory(value: unknown): SessionHistoryEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.filter(isHistoryEntry);
  return entries.length > 0 ? entries : undefined;
}

interface StoredTab {
  id: string;
  href: string;
  title: string;
  kind: WorkspaceTabKind;
  history?: unknown;
}

function isStoredTab(value: unknown): value is StoredTab {
  if (!value || typeof value !== "object") return false;
  const t = value as StoredTab;
  return (
    typeof t.id === "string" &&
    t.id.length > 0 &&
    typeof t.href === "string" &&
    typeof t.title === "string" &&
    (t.kind === "repo" || t.kind === "nav" || t.kind === "note" || t.kind === "other")
  );
}

function hydrateTab(tab: StoredTab): WorkspaceTab {
  return {
    id: tab.id,
    href: tab.href,
    title: tab.title,
    kind: tab.kind,
    history: parseHistory(tab.history) ?? seedHistory(tab.href, tab.title, 0),
  };
}

export function parseStored(raw: string | null, fallbackHref: string): WorkspaceTabsState {
  if (!raw) return seedState(fallbackHref);
  try {
    const data = JSON.parse(raw) as StoredV1;
    if (data?.v !== STORAGE_VERSION || !Array.isArray(data.tabs)) return seedState(fallbackHref);
    const tabs = data.tabs.filter(isStoredTab).slice(0, MAX_WORKSPACE_TABS).map(hydrateTab);
    if (tabs.length === 0) return seedState(fallbackHref);
    const activeId = tabs.some((t) => t.id === data.activeId) ? data.activeId : tabs[0]!.id;
    return { tabs, activeId };
  } catch {
    return seedState(fallbackHref);
  }
}

export function serializeState(state: WorkspaceTabsState): string {
  const payload: StoredV1 = { v: STORAGE_VERSION, tabs: state.tabs, activeId: state.activeId };
  return JSON.stringify(payload);
}

export function loadWorkspaceTabs(fallbackHref: string): WorkspaceTabsState {
  if (typeof window === "undefined") return seedState(fallbackHref);
  try {
    return parseStored(window.localStorage.getItem(WORKSPACE_TABS_STORAGE_KEY), fallbackHref);
  } catch {
    return seedState(fallbackHref);
  }
}

export function saveWorkspaceTabs(state: WorkspaceTabsState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WORKSPACE_TABS_STORAGE_KEY, serializeState(state));
  } catch {
    /* quota / private mode */
  }
}
