"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { isDesktop, onDesktopEvent } from "@/lib/desktop/bridge";
import { copyTextToClipboard } from "@/lib/clipboard";
import {
  CHECKING_NOTICE,
  describeCheck,
  type CheckOutcome,
  type CheckoutRebuildHint,
  type UpdateNotice,
} from "@/lib/desktop/update-result";

/**
 * The update banner.
 *
 * Deliberately a banner and not a dialog. An update prompt in front of someone
 * who opened the app to write one line is an interruption dressed up as
 * diligence — the news can wait until they look at it. Nothing here blocks the
 * app, and dismissing costs nothing because the check runs again next launch.
 *
 * Renders nothing outside the desktop app. In a browser there is no updater,
 * and a banner that can never appear is dead markup in everyone's DOM.
 */

interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  version?: string;
  notes?: string;
}

type Progress =
  | { phase: "started"; total: number | null }
  | { phase: "downloading"; downloaded: number; total: number | null }
  | { phase: "installing" }
  | { phase: "done" }
  | { phase: "failed"; error: string };

const RELEASES_URL = "https://github.com/jmcelreavey/devhub/releases";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function invoke<T>(cmd: string): Promise<T> {
  const api = (window as unknown as {
    __TAURI__?: { core: { invoke: <R>(c: string) => Promise<R> } };
  }).__TAURI__;
  if (!api) throw new Error("Not running in the desktop app");
  return api.core.invoke<T>(cmd);
}

export function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  // Result of a check the user asked for. Always shown, even when there is
  // nothing to install: a menu item that ends in silence reads as broken.
  const [notice, setNotice] = useState<UpdateNotice | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const runManualCheck = useCallback(async () => {
    setNotice(CHECKING_NOTICE);
    setShowDetails(false);
    setDismissed(false);
    let outcome: CheckOutcome;
    try {
      outcome = await invoke<CheckOutcome>("check_update_outcome");
    } catch (error) {
      outcome = {
        status: "failed",
        currentVersion: "this version",
        message: "The update check could not run.",
        details: error instanceof Error ? error.message : String(error),
      };
    }
    // The user's own checkout is a second source of "newer".
    const rebuild = await fetch("/api/rebuild", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<CheckoutRebuildHint>) : null))
      .catch(() => null);
    if (outcome.status === "available") {
      setUpdate({ available: true, currentVersion: outcome.currentVersion, version: outcome.version, notes: outcome.notes ?? undefined });
    }
    setNotice(describeCheck(outcome, rebuild));
  }, []);

  useEffect(() => {
    if (!isDesktop()) return;
    let cleanupAvailable: (() => void) | undefined;
    let cleanupProgress: (() => void) | undefined;

    void onDesktopEvent("devhub://update-available", (payload) => {
      setUpdate(payload as UpdateInfo);
      setDismissed(false);
    }).then((off) => {
      cleanupAvailable = off;
    });

    void onDesktopEvent("devhub://update-progress", (payload) => {
      setProgress(payload as Progress);
    }).then((off) => {
      cleanupProgress = off;
    });

    // The menu's "Check for Updates…" routes through the same banner, so
    // there is one place updates are presented rather than two.
    void onDesktopEvent("devhub://check-updates", () => {
      void runManualCheck();
    });

    return () => {
      cleanupAvailable?.();
      cleanupProgress?.();
    };
  }, [runManualCheck]);

  const download = useCallback(async () => {
    setBusy(true);
    try {
      await invoke("install_update");
    } catch {
      // The Rust side already emitted a `failed` progress event with the real
      // message; surfacing a second, vaguer one here would just be noise.
    } finally {
      setBusy(false);
    }
  }, []);

  const restart = useCallback(async () => {
    try {
      await invoke("relaunch");
    } catch {
      /* if relaunch fails the user can quit normally */
    }
  }, []);

  if (!isDesktop() || dismissed) return null;
  const transferring = progress?.phase === "started" || progress?.phase === "downloading" || progress?.phase === "installing" || progress?.phase === "done";
  if (notice && !transferring && progress?.phase !== "failed") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="update-banner"
        style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)", fontSize: "13px" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: "220px" }}>
            <strong style={{ color: notice.tone === "warning" ? "var(--warning, inherit)" : undefined }}>{notice.title}</strong>
            {notice.body && <span style={{ color: "var(--text-subtle)" }}> {notice.body}</span>}
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {notice.actions.includes("install") && (
              <button type="button" className="btn btn-primary" onClick={() => void download()} disabled={busy}>
                <Download size={13} /> Install
              </button>
            )}
            {notice.actions.includes("rebuild") && (
              <Link className="btn" href="/status?tab=maintenance&rebuild=1">Rebuild from my checkout</Link>
            )}
            {notice.actions.includes("retry") && (
              <button type="button" className="btn" onClick={() => void runManualCheck()}>
                <RefreshCw size={13} /> Try again
              </button>
            )}
            {notice.details && (
              <button type="button" className="btn btn-ghost" aria-expanded={showDetails} onClick={() => setShowDetails((open) => !open)}>
                Details
              </button>
            )}
            {notice !== CHECKING_NOTICE && (
              <button type="button" className="hub-icon-btn" aria-label="Dismiss" onClick={() => setDismissed(true)}>
                <X size={14} />
              </button>
            )}
          </div>
        </div>
        {showDetails && notice.details && (
          <div style={{ marginTop: "8px", display: "flex", gap: "8px", alignItems: "flex-start" }}>
            <pre style={{ flex: 1, margin: 0, whiteSpace: "pre-wrap", fontSize: "12px", color: "var(--text-subtle)" }}>{notice.details}</pre>
            <button type="button" className="btn btn-ghost" onClick={() => void copyTextToClipboard(notice.details ?? "")}>Copy</button>
          </div>
        )}
      </div>
    );
  }
  if (!update?.available && progress?.phase !== "failed") return null;

  const failed = progress?.phase === "failed";
  const done = progress?.phase === "done";
  const downloading = progress?.phase === "downloading" || progress?.phase === "started";
  const installing = progress?.phase === "installing";

  /**
   * Determinate only when the server actually told us the size. Inventing a
   * percentage from a guess produces a bar that jumps or sticks at 99%, which
   * teaches people not to trust progress bars.
   */
  const total = progress && "total" in progress ? progress.total : null;
  const downloaded = progress && "downloaded" in progress ? progress.downloaded : 0;
  const pct = total && total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="update-banner"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        flexWrap: "wrap",
        padding: "10px 14px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-elevated)",
        fontSize: "13px",
      }}
    >
      <div style={{ flex: 1, minWidth: "220px" }}>
        {failed ? (
          <>
            <strong style={{ color: "var(--danger)" }}>Update failed.</strong>{" "}
            <span style={{ color: "var(--text-subtle)" }}>
              You&rsquo;re still on {update?.currentVersion ?? "the current version"} — nothing
              changed. {progress.error}
            </span>
          </>
        ) : done ? (
          <>
            <strong>DevHub {update?.version} is ready.</strong>{" "}
            <span style={{ color: "var(--text-subtle)" }}>Restart when it suits you.</span>
          </>
        ) : installing ? (
          <span>Installing DevHub {update?.version}…</span>
        ) : downloading ? (
          <span>
            Downloading DevHub {update?.version}
            {pct !== null
              ? ` — ${pct}%`
              : downloaded > 0
                ? ` — ${formatBytes(downloaded)}`
                : "…"}
          </span>
        ) : (
          <>
            <strong>DevHub {update?.version} is available.</strong>{" "}
            <span style={{ color: "var(--text-subtle)" }}>
              You&rsquo;re on {update?.currentVersion}.
            </span>
          </>
        )}

        {(downloading || installing) && (
          <div
            style={{
              marginTop: "6px",
              height: "3px",
              borderRadius: "999px",
              background: "var(--border)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                borderRadius: "inherit",
                background: "var(--accent)",
                // Honest indeterminate: a fixed partial fill rather than an
                // animated one, so it never implies progress it cannot know.
                // scaleX instead of animating width (layout thrash).
                opacity: pct !== null ? 1 : 0.6,
                transform: `scaleX(${pct !== null ? Math.min(pct, 100) / 100 : 0.4})`,
                transformOrigin: "left center",
                transition: "transform 240ms var(--ease-swift)",
              }}
            />
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        {done ? (
          <button type="button" className="btn btn-primary" onClick={() => void restart()}>
            <RefreshCw size={13} /> Restart now
          </button>
        ) : failed ? (
          <>
            <button type="button" className="btn" onClick={() => void download()} disabled={busy}>
              Try again
            </button>
            <a className="btn btn-ghost" href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
              Open release page
            </a>
          </>
        ) : downloading || installing ? null : (
          <>
            {update?.notes && (
              <a
                className="btn btn-ghost"
                href={RELEASES_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Release notes
              </a>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void download()}
              disabled={busy}
            >
              <Download size={13} /> Download
            </button>
          </>
        )}

        {!downloading && !installing && (
          <button
            type="button"
            className="hub-icon-btn"
            aria-label="Dismiss until the next check"
            onClick={() => setDismissed(true)}
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
