"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Copy, FileText, X } from "lucide-react";
import { useToast } from "@/lib/use-toast";
import type { StandupResponse } from "@/lib/standup-params";

export interface StandupPreviewModalProps {
  open: boolean;
  loading: boolean;
  saving?: boolean;
  markdown: string;
  meta?: StandupResponse["meta"];
  onClose: () => void;
  onSaveNote: () => void | Promise<void>;
}

export function StandupPreviewModal({
  open,
  loading,
  saving = false,
  markdown,
  meta,
  onClose,
  onSaveNote,
}: StandupPreviewModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previousFocus.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const repoFailureCount = meta?.repoFailures.length ?? 0;
  const prScanFailureCount = meta?.prScanFailedRepos?.length ?? 0;

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(markdown);
      toast.success("Standup copied.");
    } catch {
      toast.error("Clipboard unavailable — try again from a user tap.");
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="standup-preview-title"
      className="standup-preview-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="standup-preview-card card">
        <div className="standup-preview-header">
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 id="standup-preview-title" className="standup-preview-title">
              Standup preview
            </h2>
            {meta && (
              <div className="standup-preview-meta">
                {meta.reposScanned} repo{meta.reposScanned === 1 ? "" : "s"} scanned
                {meta.reposExcluded > 0 ? `, ${meta.reposExcluded} excluded` : ""}
                {meta.reposScannedNames && meta.reposScannedNames.length > 0 && (
                  <details style={{ display: "inline" }}>
                    <summary style={{ display: "inline", cursor: "pointer", marginLeft: 6 }}>
                      list
                    </summary>
                    <div style={{ marginTop: 4 }}>{meta.reposScannedNames.join(", ")}</div>
                  </details>
                )}
              </div>
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
            className="btn btn-ghost inline-flex items-center justify-center"
            style={{ padding: 6 }}
            onClick={onClose}
            aria-label="Close preview"
          >
            <X size={14} aria-hidden />
          </button>
        </div>

        <div className="standup-preview-body" aria-busy={loading}>
          {loading ? "Building standup…" : markdown || "_Empty — nothing to show for this window._"}
        </div>

        <div className="standup-preview-footer">
          {repoFailureCount > 0 && (
            <span className="standup-preview-failure">
              {repoFailureCount} repo{repoFailureCount === 1 ? "" : "s"} failed git scan
              {meta?.repoFailures.length ? `: ${meta.repoFailures.join(", ")}` : ""}
            </span>
          )}
          {prScanFailureCount > 0 && (
            <span className="standup-preview-failure">
              PR scan failed for {prScanFailureCount} repo{prScanFailureCount === 1 ? "" : "s"} — PRs may be missing
              {meta?.prScanFailedRepos?.length ? `: ${meta.prScanFailedRepos.join(", ")}` : ""}
            </span>
          )}
          <button
            type="button"
            className="btn btn-ghost inline-flex items-center gap-1.5"
            onClick={() => void copyToClipboard()}
            disabled={loading || !markdown}
          >
            <Copy size={13} aria-hidden /> Copy
          </button>
          <button
            type="button"
            className="btn btn-primary inline-flex items-center gap-1.5"
            onClick={() => void onSaveNote()}
            disabled={loading || saving}
            aria-busy={saving}
          >
            <FileText size={13} aria-hidden /> {saving ? "Saving..." : "Save as daily note"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
