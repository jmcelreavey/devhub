"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Info, Trash2, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { usePwaInstall } from "@/lib/use-pwa-install";

const DISMISSED_KEY = "devhub:pwa-dismissed";
/** Separate from the global install pill — old “dismiss” must not hide Status-only browser instructions. */
const STATUS_BROWSER_HINT_DISMISSED_KEY = "devhub:pwa-status-browser-hint-dismissed";

export function PWAInstallPrompt() {
  const { canInstall, installed, runningStandalone, install, forgetPersistedInstall } = usePwaInstall();
  const pathname = usePathname();
  const [showUninstallHelp, setShowUninstallHelp] = useState(false);
  /** Must match server first paint — never read `localStorage` in a `useState` initializer. */
  const [dismissed, setDismissed] = useState(false);
  const [statusBrowserHintDismissed, setStatusBrowserHintDismissed] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      try {
        setDismissed(localStorage.getItem(DISMISSED_KEY) === "1");
        setStatusBrowserHintDismissed(localStorage.getItem(STATUS_BROWSER_HINT_DISMISSED_KEY) === "1");
      } catch {
        /* ignore private mode / quota */
      }
    });
    return () => cancelAnimationFrame(id);
  }, []);

  // Status is the canonical place for install/uninstall; match bare `/status`
  // and prefixed paths (reverse proxy / future basePath).
  const onStatusPage =
    pathname === "/status" ||
    pathname === "/status/" ||
    (typeof pathname === "string" && /(^|\/)status\/?$/.test(pathname));

  const uninstallHelp = useMemo(() => {
    if (typeof navigator === "undefined") return "Use your browser/app menu to uninstall this app.";
    const ua = navigator.userAgent;
    if (/Edg\//i.test(ua)) {
      return "Edge: open the app window menu (⋯) and choose App settings → Uninstall DevHub.";
    }
    if (/Chrome\//i.test(ua) || /Chromium\//i.test(ua)) {
      return "Chrome: open the app window menu (⋮) and choose Uninstall DevHub… (or remove from chrome://apps).";
    }
    if (/iPhone|iPad|iPod/i.test(ua)) {
      return "iOS: long-press the home-screen icon, tap Remove App, then Delete App.";
    }
    return "Open your browser/app menu and remove the installed app for this site.";
  }, []);

  if (installed && !onStatusPage) return null;
  if (!installed && !canInstall && !onStatusPage) return null;
  if (!installed && dismissed && !onStatusPage) return null;
  // On Status, “no prompt yet” card can be dismissed like other routes.
  const showStatusBrowserHint = onStatusPage && !installed && !canInstall;
  if (showStatusBrowserHint && statusBrowserHintDismissed) return null;

  function persistDismissed() {
    setDismissed(true);
    try { localStorage.setItem(DISMISSED_KEY, "1"); } catch {}
  }

  function persistStatusBrowserHintDismissed() {
    setStatusBrowserHintDismissed(true);
    try { localStorage.setItem(STATUS_BROWSER_HINT_DISMISSED_KEY, "1"); } catch {}
  }

  function onClickDismiss() {
    if (showStatusBrowserHint) persistStatusBrowserHintDismissed();
    else persistDismissed();
  }

  return (
    <div
      className="card"
      style={{
        position: "fixed",
        bottom: "calc(var(--shelf-h, 0px) + 16px)",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 450,
        padding: "10px 16px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        width: "min(92vw, 30rem)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        {installed ? (
          <Trash2 size={14} style={{ color: "var(--warning)", flexShrink: 0 }} />
        ) : canInstall ? (
          <Download size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />
        ) : (
          <Info size={14} style={{ color: "var(--text-subtle)", flexShrink: 0 }} />
        )}
        <span className="text-sm flex-1 min-w-0" style={{ color: "var(--text)" }}>
          {installed ? "Installed as app" : canInstall ? "Install as app?" : "App install & removal"}
        </span>
        <button
          type="button"
          onClick={onClickDismiss}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-subtle)", flexShrink: 0, display: "grid", placeItems: "center", width: 28, height: 28 }}
          aria-label={showStatusBrowserHint ? "Dismiss app install hint" : "Dismiss install prompt"}
        >
          <X size={16} />
        </button>
      </div>
      {installed ? (
        <button
          className="btn btn-ghost self-start"
          style={{ fontSize: "12px", padding: "4px 12px" }}
          onClick={() => setShowUninstallHelp((v) => !v)}
        >
          {showUninstallHelp ? "Hide uninstall help" : "Uninstall"}
        </button>
      ) : canInstall ? (
        <button
          className="btn btn-primary self-start"
          style={{ fontSize: "12px", padding: "4px 12px" }}
          onClick={async () => {
            await install();
            persistDismissed();
          }}
        >
          Install
        </button>
      ) : (
        <span className="text-xs leading-snug" style={{ color: "var(--text-muted)" }}>
          This tab doesn’t have the browser’s one-tap prompt. Use the browser menu to{" "}
          <strong className="font-medium" style={{ color: "var(--text)" }}>Install</strong> or{" "}
          <strong className="font-medium" style={{ color: "var(--text)" }}>Uninstall</strong> DevHub, or reload and try again.
        </span>
      )}
      {installed && showUninstallHelp && (
        <div className="w-full space-y-2 text-xs" style={{ color: "var(--text-muted)" }}>
          <p>{uninstallHelp}</p>
          {!runningStandalone && typeof navigator !== "undefined" && /Chrome|Chromium|Edg\//i.test(navigator.userAgent) && (
            <p>
              In this normal tab, Chrome/Edge may show <strong className="font-medium" style={{ color: "var(--text)" }}>Open in app</strong> in the address bar - that means DevHub is installed. Open it from there to get the app window, then use that window’s menu to uninstall.
            </p>
          )}
          {!runningStandalone && (
            <p>
              <button
                type="button"
                className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
                style={{ color: "var(--text-subtle)" }}
                onClick={() => {
                  forgetPersistedInstall();
                  setShowUninstallHelp(false);
                }}
              >
                I already removed the app - reset this notice
              </button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
