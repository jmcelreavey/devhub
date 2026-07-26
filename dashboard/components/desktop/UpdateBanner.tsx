"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw, X } from "lucide-react";
import { isDesktop, onDesktopEvent } from "@/lib/desktop/bridge";

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
      void invoke<UpdateInfo>("check_update")
        .then((info) => {
          setUpdate(info);
          setDismissed(false);
        })
        .catch(() => {
          /* the menu item is fire-and-forget; failures show on next check */
        });
    });

    return () => {
      cleanupAvailable?.();
      cleanupProgress?.();
    };
  }, []);

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
                width: pct !== null ? `${pct}%` : "40%",
                opacity: pct !== null ? 1 : 0.6,
                transition: "width 240ms cubic-bezier(.22,1,.36,1)",
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
