"use client";

import { useState } from "react";
import { Share2, Globe, Loader2, Copy, X, RefreshCw, AlertTriangle } from "lucide-react";
import { useLive } from "@/lib/use-fetch";
import { useToast } from "@/lib/use-toast";
import { copyTextToClipboard } from "@/lib/clipboard";
import { HoverTip } from "@/components/HoverTip";
import { shareKey, type ShareStatus, type VaultId } from "@/lib/share/share-public";

interface Props {
  vaultId: VaultId;
  path: string;
}

/**
 * Publish/unpublish the current note or doc as a secret GitHub Gist. "Live"
 * means a shareable gist exists; the registry is the single source of truth
 * (see /shared for the full list).
 */
export function ShareControls({ vaultId, path }: Props) {
  const toast = useToast();
  const { data, mutate } = useLive<{ shares: ShareStatus[] }>("/api/share");
  const [busy, setBusy] = useState(false);
  const live = data?.shares.find((s) => s.key === shareKey(vaultId, path)) ?? null;

  const publish = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vault: vaultId, path }),
      });
      const body = (await res.json().catch(() => ({}))) as { share?: { url: string }; error?: string };
      if (!res.ok || !body.share) throw new Error(body.error ?? res.statusText);
      await mutate();
      await copyTextToClipboard(body.share.url).catch(() => {});
      toast.success(live ? "Updated — link copied" : "Live — link copied");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not publish.");
    } finally {
      setBusy(false);
    }
  };

  const unshare = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/share", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vault: vaultId, path }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? res.statusText);
      }
      await mutate();
      toast.success("Removed from live.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not unshare.");
    } finally {
      setBusy(false);
    }
  };

  if (!live) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={publish}
        title="Publish as a secret gist link"
        className="btn btn-ghost text-xs flex items-center gap-1 shrink-0"
      >
        {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Share2 size={14} aria-hidden />}
        Share
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1 shrink-0">
      {live.missing ? (
        <span
          className="btn btn-ghost text-xs flex items-center gap-1 cursor-default"
          style={{ color: "var(--danger)" }}
          title="The source note no longer exists. Remove this dead link."
        >
          <AlertTriangle size={14} aria-hidden />
          Source gone
        </span>
      ) : (
        <a
          href={live.url}
          target="_blank"
          rel="noreferrer"
          className="btn btn-ghost text-xs flex items-center gap-1 no-underline"
          style={{ color: live.stale ? "var(--warning)" : "var(--success)" }}
          title={live.stale ? "Live, but out of date — open published gist" : "Open live gist"}
        >
          {live.stale ? <AlertTriangle size={14} aria-hidden /> : <Globe size={14} aria-hidden />}
          {live.stale ? "Stale" : "Live"}
        </a>
      )}

      {live.stale && !live.missing ? (
        <button
          type="button"
          disabled={busy}
          onClick={publish}
          className="btn btn-ghost text-xs flex items-center gap-1"
          style={{ color: "var(--warning)" }}
          title="Push the current content to the live link"
        >
          {busy ? (
            <Loader2 size={13} className="animate-spin" aria-hidden />
          ) : (
            <RefreshCw size={13} aria-hidden />
          )}
          Update
        </button>
      ) : null}

      {!live.missing ? (
        <HoverTip label="Copy link">
          <button
            type="button"
            onClick={() => {
              void copyTextToClipboard(live.url).then(
                () => toast.success("Link copied."),
                () => toast.error("Could not copy link."),
              );
            }}
            className="btn btn-ghost text-xs flex items-center justify-center px-1.5"
            aria-label="Copy live link"
          >
            <Copy size={13} aria-hidden />
          </button>
        </HoverTip>
      ) : null}

      <HoverTip label="Remove from live">
        <button
          type="button"
          disabled={busy}
          onClick={unshare}
          className="btn btn-danger-ghost text-xs flex items-center justify-center px-1.5"
          aria-label="Remove from live"
        >
          <X size={14} aria-hidden />
        </button>
      </HoverTip>
    </div>
  );
}
