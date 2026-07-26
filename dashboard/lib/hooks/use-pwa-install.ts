"use client";

import { useEffect, useSyncExternalStore } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// We capture `beforeinstallprompt` once at module load so the deferred event
// is available to every component on every route — even if the user navigates
// away from the page that first received it. Without this the install button
// would only work on whatever route happened to be open when Chrome fired the
// event.
let stashed: BeforeInstallPromptEvent | null = null;
const subscribers = new Set<() => void>();

/** Set when the user completes install — survives refresh in a normal browser tab (standalone is only true inside the installed window). */
const PWA_INSTALLED_KEY = "devhub:pwa-installed";

function notify() {
  for (const cb of subscribers) cb();
}

function getStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  // Installed PWAs are usually `standalone`; some environments use `fullscreen`.
  const modes = ["standalone", "fullscreen"] as const;
  for (const mode of modes) {
    if (window.matchMedia?.(`(display-mode: ${mode})`).matches) return true;
  }
  return false;
}

function readPersistedInstalledHint(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PWA_INSTALLED_KEY) === "1";
  } catch {
    return false;
  }
}

function persistInstalledHint(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PWA_INSTALLED_KEY, "1");
  } catch {
    /* ignore quota / private mode */
  }
}

/** Clears the “installed from this browser” hint so the install pill can return after a real uninstall. */
export function forgetPersistedPwaInstallHint(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PWA_INSTALLED_KEY);
  } catch {
    /* ignore */
  }
  notify();
}

/** After `navigator.getInstalledRelatedApps()` (needs `related_applications` in the manifest). */
let relatedAppsInstalled: boolean | undefined;

async function probeInstalledRelatedApps(): Promise<void> {
  if (typeof window === "undefined") return;
  const nav = navigator as Navigator & {
    getInstalledRelatedApps?: () => Promise<{ platform?: string; url?: string }[]>;
  };
  if (typeof nav.getInstalledRelatedApps !== "function") {
    relatedAppsInstalled = false;
    return;
  }
  try {
    const apps = await nav.getInstalledRelatedApps();
    relatedAppsInstalled = Array.isArray(apps) && apps.length > 0;
  } catch {
    relatedAppsInstalled = false;
  }
  notify();
}

function isInstalledForUi(): boolean {
  if (getStandalone() || readPersistedInstalledHint()) return true;
  return relatedAppsInstalled === true;
}

if (typeof window !== "undefined") {
  void probeInstalledRelatedApps();
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    stashed = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    stashed = null;
    persistInstalledHint();
    notify();
  });
}

interface PwaInstallSnapshot {
  canInstall: boolean;
  /**
   * True when running as the PWA window, when we persisted install from this profile,
   * or when `navigator.getInstalledRelatedApps()` reports this manifest (Chrome/Edge in a normal tab).
   */
  installed: boolean;
  runningStandalone: boolean;
}

let cachedSnapshot: PwaInstallSnapshot = {
  canInstall: false,
  installed: false,
  runningStandalone: false,
};
/** Stable reference for SSR — `useSyncExternalStore` requires cached server snapshots. */
const SERVER_SNAPSHOT: PwaInstallSnapshot = {
  canInstall: false,
  installed: false,
  runningStandalone: false,
};

function getSnapshot(): PwaInstallSnapshot {
  const next: PwaInstallSnapshot = {
    canInstall: stashed !== null,
    installed: isInstalledForUi(),
    runningStandalone: getStandalone(),
  };
  if (
    next.canInstall !== cachedSnapshot.canInstall ||
    next.installed !== cachedSnapshot.installed ||
    next.runningStandalone !== cachedSnapshot.runningStandalone
  ) {
    cachedSnapshot = next;
  }
  return cachedSnapshot;
}
function getServerSnapshot(): PwaInstallSnapshot {
  return SERVER_SNAPSHOT;
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

export async function triggerInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!stashed) return "unavailable";
  const ev = stashed;
  await ev.prompt();
  const choice = await ev.userChoice;
  // Chrome consumes the prompt after one call — clear it so we don't try to
  // reuse a spent event. If the user dismissed, Chrome will re-fire the event
  // on a later page load.
  stashed = null;
  if (choice.outcome === "accepted") persistInstalledHint();
  notify();
  return choice.outcome;
}

/**
 * Subscribes a component to PWA install availability. Returns `canInstall` —
 * true when the browser fired `beforeinstallprompt` and we haven't consumed
 * it yet — and `installed`, true in standalone mode or after install from this
 * browser profile (so the Status page can still show uninstall guidance in a
 * normal tab).
 */
export function usePwaInstall(): PwaInstallSnapshot & {
  install: typeof triggerInstall;
  forgetPersistedInstall: typeof forgetPersistedPwaInstallHint;
} {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChange = () => {
      notify();
    };
    const mql = window.matchMedia?.("(display-mode: standalone)");
    mql?.addEventListener?.("change", onChange);
    return () => {
      mql?.removeEventListener?.("change", onChange);
    };
  }, []);

  return { ...snap, install: triggerInstall, forgetPersistedInstall: forgetPersistedPwaInstallHint };
}
