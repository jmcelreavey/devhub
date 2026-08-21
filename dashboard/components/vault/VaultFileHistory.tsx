"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { History, Loader2 } from "lucide-react";
import { formatRelativePastAge } from "@/lib/utils";
import type { VaultId } from "@/lib/vault/vault-client";

interface HistoryCommit {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  relativeDate: string;
}

interface HistoryResponse {
  available: boolean;
  path?: string;
  commits?: HistoryCommit[];
  error?: string;
}

const ABSOLUTE_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * Last-edit stamp + git commit list for a vault file.
 *
 * mtime is the live "edited" signal (includes unsynced saves). Commits are
 * whatever `git log --follow` knows about once the file lives in the checkout.
 */
export function VaultFileHistory({
  vaultId,
  path,
  modifiedMs,
  compact = false,
}: {
  vaultId: VaultId;
  path: string;
  modifiedMs: number | null;
  /** Meta-row chip style (docs article) vs editor toolbar button. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<HistoryResponse | null>(null);
  /** Relative labels need a client clock — keep absolute until mounted. */
  const [nowMs, setNowMs] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client clock is only safe to read after mount
    setNowMs(Date.now());
  }, []);

  const editedTitle =
    modifiedMs != null && modifiedMs > 0 ? ABSOLUTE_FORMAT.format(new Date(modifiedMs)) : undefined;
  const editedLabel =
    modifiedMs != null && modifiedMs > 0
      ? nowMs != null
        ? formatRelativePastAge(Math.max(0, nowMs - modifiedMs))
        : ABSOLUTE_FORMAT.format(new Date(modifiedMs))
      : null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ vault: vaultId, path });
      const res = await fetch(`/api/vault/history?${qs}`);
      const json = (await res.json().catch(() => ({}))) as HistoryResponse;
      if (!res.ok) {
        setData({ available: false, error: json.error ?? "Could not load history" });
        return;
      }
      setData(json);
    } catch (err) {
      setData({
        available: false,
        error: err instanceof Error ? err.message : "Could not load history",
      });
    } finally {
      setLoading(false);
    }
  }, [vaultId, path]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() flips its own loading flag when the panel opens
    void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    function onPointer(e: MouseEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  const triggerClass = compact
    ? "docs-meta-item"
    : "btn btn-ghost text-xs flex items-center gap-1 shrink-0";

  return (
    <div className="relative inline-flex" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClass}
        style={
          compact
            ? {
                appearance: "none",
                border: 0,
                background: "transparent",
                padding: 0,
                font: "inherit",
                color: "inherit",
                cursor: "pointer",
              }
            : undefined
        }
        aria-expanded={open}
        aria-controls={panelId}
        title={editedTitle ? `Edited ${editedTitle} — view history` : "View edit history"}
        onClick={() => setOpen((v) => !v)}
      >
        <History size={compact ? 11 : 13} aria-hidden />
        {editedLabel ? `Edited ${editedLabel}` : "History"}
      </button>
      {open ? (
        <div
          id={panelId}
          className="launch-menu"
          role="dialog"
          aria-label="File history"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            left: "auto",
            width: "min(22rem, calc(100vw - 1.5rem))",
            minWidth: "16rem",
          }}
        >
          <div className="px-2 pb-2 mb-1 text-[11px] font-semibold text-text-muted border-b border-[var(--border-muted)]">
            <div>History</div>
            {editedTitle ? (
              <div className="mt-0.5 font-normal text-[10px] text-text-subtle">
                Disk last modified {editedTitle}
              </div>
            ) : null}
            {data?.path ? (
              <code className="block mt-0.5 font-normal text-[10px] text-text-subtle truncate">
                {data.path}
              </code>
            ) : null}
          </div>
          {loading && !data ? (
            <div className="flex items-center gap-1.5 px-2 py-2 text-xs text-text-subtle">
              <Loader2 size={12} className="animate-spin" aria-hidden /> Loading…
            </div>
          ) : data?.error ? (
            <div className="px-2 py-2 text-xs text-text-subtle">{data.error}</div>
          ) : data && !data.available ? (
            <div className="px-2 py-2 text-xs text-text-subtle">
              No git checkout for this vault — commit history needs the DevHub repo.
              {editedTitle ? " Disk timestamp above still applies." : null}
            </div>
          ) : (data?.commits?.length ?? 0) === 0 ? (
            <div className="px-2 py-2 text-xs text-text-subtle">
              No commits yet — file exists on disk
              {editedTitle ? ` (modified ${editedTitle})` : ""}. Save and sync to start a trail.
            </div>
          ) : (
            <ul className="repo-git-blame-history !max-h-64 !m-0 !border-0 !p-0 !bg-transparent">
              {data!.commits!.map((c) => (
                <li
                  key={c.hash}
                  className="repo-git-blame-history-row !cursor-default px-1.5 py-1 rounded-[var(--radius-sm)]"
                  title={`${c.author} · ${c.hash}`}
                >
                  <span className="font-mono text-accent">{c.shortHash}</span>
                  <span className="truncate">{c.subject || "(no subject)"}</span>
                  <span className="text-text-subtle shrink-0">{c.relativeDate}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
