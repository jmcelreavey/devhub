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
  event?: {
    listen: (event: string, handler: (e: { payload: unknown }) => void) => Promise<() => void>;
  };
}

interface TauriInternals {
  invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

type BridgeLogPhase =
  | "bridge:open"
  | "bridge:tauri-detect"
  | "bridge:invoke"
  | "nav:external-intercept";

function tauri(): TauriGlobal | null {
  if (typeof window === "undefined") return null;
  const globals = window as unknown as {
    __TAURI__?: TauriGlobal;
    __TAURI_INTERNALS__?: TauriInternals;
  };
  if (globals.__TAURI__) return globals.__TAURI__;
  // Attached localhost pages are remote origins, where Tauri may expose only
  // its internal invoke bridge rather than the convenience __TAURI__ global.
  const invoke = globals.__TAURI_INTERNALS__?.invoke;
  return invoke ? { core: { invoke } } : null;
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
  let absolute: string;
  let host: string | undefined;
  try {
    if (!url.trim()) throw new Error("No URL was provided.");
    const parsed = new URL(url, window.location.href);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`Unsupported URL protocol: ${parsed.protocol}`);
    }
    absolute = parsed.toString();
    host = parsed.host;
  } catch (error) {
    reportOpenFailure(error);
    return;
  }

  const api = tauri();
  if (!api) {
    console.debug("[bridge:tauri-detect] Tauri bridge unavailable; using browser fallback", { host });
    if (!window.open(absolute, "_blank", "noopener,noreferrer")) {
      reportOpenFailure(new Error("The browser blocked the new window."));
    }
    return;
  }
  await logBridgeEvent(api, "bridge:tauri-detect", "Tauri bridge detected", host);
  await logBridgeEvent(api, "bridge:open", "Opening URL in system browser", host);
  try {
    await api.core.invoke("plugin:opener|open_url", { url: absolute });
    await logBridgeEvent(api, "bridge:invoke", "System browser open succeeded", host);
  } catch (error) {
    await logBridgeEvent(api, "bridge:invoke", `System browser open failed: ${errorMessage(error)}`, host);
    reportOpenFailure(error);
  }
}

/** Record a concise desktop event without exposing URL paths or query strings. */
export async function logDesktopEvent(
  phase: Extract<BridgeLogPhase, "nav:external-intercept">,
  message: string,
  host?: string,
): Promise<void> {
  const api = tauri();
  if (!api) {
    console.debug(`[${phase}] ${message}`, { host });
    return;
  }
  await logBridgeEvent(api, phase, message, host);
}

async function logBridgeEvent(
  api: TauriGlobal,
  phase: BridgeLogPhase,
  message: string,
  host?: string,
): Promise<void> {
  try {
    await api.core.invoke("renderer_log", { phase, message, host });
  } catch (error) {
    // Logging must never make an external link fail. This is also useful when
    // the bridge itself is the broken part, where a persistent log is impossible.
    console.warn(`[${phase}] Could not write desktop log: ${errorMessage(error)}`);
  }
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https?:\/\/[^\s?]+(?:\?[^\s]*)?/gi, (url) => url.split("?")[0])
    .replace(/([?&](?:token|key|secret|password|authorization)=)[^&\s]+/gi, "$1[redacted]")
    .slice(0, 500);
}

function reportOpenFailure(error: unknown): void {
  console.error("DevHub could not open the URL in the system browser.", error);
  window.dispatchEvent(new CustomEvent("devhub:external-open-failed"));
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
  if (!api?.event) return () => {};
  try {
    return await api.event.listen(event, (e) => handler(e.payload));
  } catch {
    return () => {};
  }
}
