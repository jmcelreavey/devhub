"use client";

import { useState } from "react";
import Link from "next/link";
import { Globe, Copy, Trash2, ExternalLink, RefreshCw, AlertTriangle, Loader2 } from "lucide-react";
import { useLive } from "@/lib/use-fetch";
import { useToast } from "@/lib/use-toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { getVaultClient } from "@/lib/vault/vault-client";
import { shareExpiresAt, type ShareRecord, type ShareStatus } from "@/lib/share/share-public";

function noteHref(share: ShareRecord): string {
  return getVaultClient(share.vault).paths.pageHref(share.path);
}

/** "Expires today" / "Expires in 3 days" — surfaces the 14-day auto-cleanup. */
function expiryLabel(share: ShareRecord, now = Date.now()): string {
  const days = Math.ceil((shareExpiresAt(share) - now) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "Expires today";
  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
}

export default function SharedClient() {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, mutate, isValidating } = useLive<{ shares: ShareStatus[] }>("/api/share");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const shares = data?.shares ?? [];

  const pushUpdate = async (share: ShareStatus) => {
    setBusyKey(share.key);
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vault: share.vault, path: share.path }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? res.statusText);
      }
      await mutate();
      toast.success("Live link updated.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update.");
    } finally {
      setBusyKey(null);
    }
  };

  const removeOne = async (share: ShareStatus) => {
    setBusyKey(share.key);
    try {
      const res = await fetch("/api/share", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vault: share.vault, path: share.path }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? res.statusText);
      }
      await mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove.");
    } finally {
      setBusyKey(null);
    }
  };

  const removeAll = async () => {
    const ok = await confirm({
      title: "Remove all live links",
      message: `Delete all ${shares.length} live gist${shares.length === 1 ? "" : "s"}? This cannot be undone.`,
      confirmLabel: "Remove all",
      variant: "danger",
    });
    if (!ok) return;
    setClearing(true);
    try {
      const res = await fetch("/api/share?all=1", { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? res.statusText);
      }
      await mutate();
      toast.success("All live links removed.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove all.");
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="page-wrapper">
      <div className="page-header">
        <div className="page-title">Live links</div>
        <div className="flex items-center gap-2">
          <span className="badge badge-muted">{shares.length}</span>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: "12px", padding: "4px 10px" }}
            onClick={() => mutate()}
            disabled={isValidating}
            aria-label="Refresh live links"
          >
            <RefreshCw size={12} className={isValidating ? "animate-spin" : ""} aria-hidden />
          </button>
          {shares.length > 0 && (
            <button
              type="button"
              className="btn btn-danger-ghost"
              style={{ fontSize: "12px", padding: "4px 10px" }}
              onClick={removeAll}
              disabled={clearing}
            >
              <Trash2 size={12} aria-hidden /> Remove all
            </button>
          )}
        </div>
      </div>

      <p className="text-xs mb-4" style={{ color: "var(--text-subtle)" }}>
        Notes and docs published as secret GitHub Gists. Anyone with the link can read them until you remove
        them here or from the note.
      </p>

      {shares.length === 0 ? (
        <div className="card card-body text-sm" style={{ color: "var(--text-muted)" }}>
          Nothing is live. Open a note or doc and hit <strong>Share</strong> to publish it.
        </div>
      ) : (
        <div className="space-y-2">
          {shares.map((share) => (
            <div
              key={share.key}
              className="card group flex items-center gap-3"
              style={{ padding: "10px 12px" }}
            >
              {share.stale ? (
                <AlertTriangle
                  size={15}
                  style={{ color: share.missing ? "var(--danger)" : "var(--warning)", flexShrink: 0 }}
                  aria-hidden
                />
              ) : (
                <Globe size={15} style={{ color: "var(--success)", flexShrink: 0 }} aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <Link href={noteHref(share)} className="text-sm font-medium hover:underline no-underline">
                  {share.title}
                </Link>
                <div className="text-xs truncate" style={{ color: "var(--text-subtle)" }}>
                  {share.vault} · {share.path}
                </div>
              </div>
              {share.missing ? (
                <span className="badge text-xs shrink-0" style={{ color: "var(--danger)" }}>
                  Source deleted
                </span>
              ) : share.stale ? (
                <span className="badge text-xs shrink-0" style={{ color: "var(--warning)" }}>
                  Stale
                </span>
              ) : null}
              <span
                className="badge badge-muted text-xs shrink-0"
                title={`Published ${new Date(share.createdAt).toLocaleString()}`}
              >
                {expiryLabel(share)}
              </span>
              {share.stale && !share.missing ? (
                <button
                  type="button"
                  disabled={busyKey === share.key}
                  onClick={() => pushUpdate(share)}
                  className="btn btn-ghost text-xs flex items-center gap-1 shrink-0"
                  style={{ color: "var(--warning)" }}
                  title="Push current content to the live link"
                >
                  {busyKey === share.key ? (
                    <Loader2 size={13} className="animate-spin" aria-hidden />
                  ) : (
                    <RefreshCw size={13} aria-hidden />
                  )}
                  Update
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(share.url);
                  toast.success("Link copied.");
                }}
                className="btn btn-ghost text-xs flex items-center justify-center px-1.5 shrink-0"
                aria-label="Copy link"
              >
                <Copy size={13} aria-hidden />
              </button>
              <a
                href={share.url}
                target="_blank"
                rel="noreferrer"
                className="btn btn-ghost text-xs flex items-center justify-center px-1.5 shrink-0 no-underline"
                aria-label="Open gist"
              >
                <ExternalLink size={13} aria-hidden />
              </a>
              <button
                type="button"
                disabled={busyKey === share.key}
                onClick={() => removeOne(share)}
                className="btn btn-danger-ghost text-xs flex items-center justify-center px-1.5 shrink-0"
                aria-label="Remove from live"
              >
                <Trash2 size={13} aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
