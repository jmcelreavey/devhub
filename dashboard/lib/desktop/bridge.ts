"use client";

/**
 * The one place the dashboard talks to the Tauri shell.
 *
 * Everything native goes through this adapter, and every function degrades to
 * a browser-mode fallback. That is not politeness — the dashboard genuinely
 * runs in two places (a browser tab during `npm run dev`, a webview in the
 * shipped app), and a component that calls `window.__TAURI__` directly is a
 * component that crashes in one of them.
 *
 * The surface is deliberately tiny. This page is a *remote origin* from the
 * shell's point of view, so every function here is something a web page can
 * call. There is no generic "run a command" and there will not be one.
 */

interface TauriGlobal {
  core: { invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> };
  event: {
    listen: (event: string, handler: (e: { payload: unknown }) => void) => Promise<() => void>;
  };
}

function tauri(): TauriGlobal | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__ ?? null;
}

/** True inside the packaged desktop app. */
export function isDesktop(): boolean {
  return tauri() !== null;
}

export interface DesktopInfo {
  desktop: boolean;
  version: string;
  appData: string;
  resourceRoot: string;
  logPath: string;
}

export async function desktopInfo(): Promise<DesktopInfo | null> {
  const api = tauri();
  if (!api) return null;
  try {
    return await api.core.invoke<DesktopInfo>("desktop_info");
  } catch {
    return null;
  }
}

/**
 * Native directory picker, or `null` when there isn't one.
 *
 * `null` means "no native picker available", not "the user cancelled" —
 * callers must keep a typed-path input as the fallback, which is also what
 * browser mode uses. Returning a fake path here to keep call sites simple
 * would produce a setup step that silently saves a directory nobody chose.
 */
export async function pickFolder(title?: string): Promise<string | null> {
  const api = tauri();
  if (!api) return null;
  try {
    return await api.core.invoke<string | null>("pick_folder", { title });
  } catch {
    return null;
  }
}

/**
 * Open a URL in the user's real browser.
 *
 * `window.open(url, "_blank")` does nothing in the desktop app — Tauri blocks
 * new windows, silently. Every "Browser view" and "Open in new tab" control in
 * the app was therefore dead on click. This routes through the shell's opener
 * instead, and falls back to `window.open` in an actual browser where that
 * works fine.
 *
 * Relative URLs are resolved against the current origin first, because the
 * shell needs an absolute URL and the call sites naturally write "/chamber".
 */
export async function openInBrowser(url: string): Promise<void> {
  const absolute = new URL(url, window.location.href).toString();
  const api = tauri();
  if (!api) {
    window.open(absolute, "_blank", "noopener,noreferrer");
    return;
  }
  try {
    await api.core.invoke("plugin:opener|open_url", { url: absolute });
  } catch {
    // Last resort; harmless if it also does nothing.
    window.open(absolute, "_blank", "noopener,noreferrer");
  }
}

/** Open the log folder in the OS file manager. No-op in a browser. */
export async function openLogs(): Promise<void> {
  const api = tauri();
  if (!api) return;
  try {
    await api.core.invoke("open_logs");
  } catch {
    /* the menu item exists as a fallback */
  }
}

/**
 * Subscribe to a shell event. Returns an unsubscribe function that is safe to
 * call in a browser, so effects can clean up without branching.
 */
export async function onDesktopEvent(
  event: string,
  handler: (payload: unknown) => void,
): Promise<() => void> {
  const api = tauri();
  if (!api) return () => {};
  try {
    return await api.event.listen(event, (e) => handler(e.payload));
  } catch {
    return () => {};
  }
}
