"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Globe,
  Trash2,
  ExternalLink,
  RefreshCw,
  AlertTriangle,
  ClipboardCopy,
  FileText,
} from "lucide-react";
import { useLive } from "@/lib/hooks/use-fetch";
import { useToast } from "@/lib/hooks/use-toast";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useConfirm } from "@/components/shell/ConfirmDialog";
import {
  ContextMenu,
  RowMenuKebab,
  useContextMenu,
  type ContextMenuGroup,
} from "@/components/shell/ContextMenu";
import { OneTimeLinksSection } from "@/components/OneTimeLinksSection";
import { getVaultClient } from "@/lib/vault/vault-client";
import { shareExpiresAt, type ShareRecord, type ShareStatus } from "@/lib/share/share-public";

const icon = { size: 12 as const };

function noteHref(share: ShareRecord): string {
  return getVaultClient(share.vault).paths.pageHref(share.path);
}

/** "Expires today" / "Expires in 3 days" — surfaces the 14-day auto-cleanup. */
function expiryLabel(share: ShareRecord, now = Date.now()): string {
  const days = Math.ceil((shareExpiresAt(share) - now) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "Expires today";
  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
}

function LiveLinkRow({
  share,
  busy,
  onUpdate,
  onRemove,
}: {
  share: ShareStatus;
  busy: boolean;
  onUpdate: () => void;
  onRemove: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const menu = useContextMenu<"row">();
  const href = noteHref(share);
  const canUpdate = share.stale && !share.missing;
  const groups: ContextMenuGroup[] = [
    {
      id: "open",
      items: [
        {
          id: "open",
          label: "Open",
          icon: <FileText {...icon} aria-hidden />,
          onSelect: () => router.push(href),
        },
        {
          id: "gist",
          label: "Open gist",
          icon: <ExternalLink {...icon} aria-hidden />,
          onSelect: () => {
            window.open(share.url, "_blank", "noopener,noreferrer");
          },
        },
      ],
    },
    {
      id: "file",
      items: [
        {
          id: "copy",
          label: "Copy link",
          icon: <ClipboardCopy {...icon} aria-hidden />,
          onSelect: () => {
            void copyTextToClipboard(share.url).then(
              () => toast.success("Link copied."),
              () => toast.error("Could not copy link."),
            );
          },
        },
        {
          id: "update",
          label: busy ? "Updating…" : "Update",
          description: "Push current content to the live link",
          icon: <RefreshCw {...icon} aria-hidden />,
          disabled: busy || !canUpdate,
          disabledReason: canUpdate ? undefined : "Source is up to date.",
          onSelect: onUpdate,
        },
      ],
    },
    {
      id: "danger",
      items: [
        {
          id: "remove",
          label: "Remove",
          icon: <Trash2 {...icon} aria-hidden />,
          danger: true,
          disabled: busy,
          onSelect: onRemove,
        },
      ],
    },
  ];

  return (
    <div className="card group flex items-center gap-3" style={{ padding: "10px 12px" }} {...menu.bindRow("row")}>
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
        <Link
          href={href}
          className="text-sm font-medium hover:underline no-underline"
          onContextMenu={(event) => event.preventDefault()}
        >
          {share.title}
        </Link>
        <div className="text-xs truncate text-text-subtle">
          {share.vault} · {share.path}
        </div>
      </div>
      {share.missing ? (
        <span className="badge text-xs shrink-0 text-danger">Source deleted</span>
      ) : share.stale ? (
        <span className="badge text-xs shrink-0 text-warning">Stale</span>
      ) : null}
      <span
        className="badge badge-muted text-xs shrink-0"
        title={`Published ${new Date(share.createdAt).toLocaleString()}`}
      >
        {expiryLabel(share)}
      </span>
      <RowMenuKebab
        label={`Actions for ${share.title}`}
        onOpen={(x, y) => menu.openAtPoint(x, y, "row")}
      />
      <ContextMenu
        open={menu.target !== null}
        position={menu.position}
        groups={groups}
        onClose={menu.close}
        label={`${share.title} actions`}
      />
    </div>
  );
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

      <p className="text-xs mb-4 text-text-subtle">
        Notes and docs published as secret GitHub Gists. Anyone with the link can read them until you remove
        them here or from the note.
      </p>

      {shares.length === 0 ? (
        <div className="card card-body text-sm text-text-muted">
          Nothing is live. Open a note or doc and hit <strong>Share</strong> to publish it.
        </div>
      ) : (
        <div className="space-y-2">
          {shares.map((share) => (
            <LiveLinkRow
              key={share.key}
              share={share}
              busy={busyKey === share.key}
              onUpdate={() => void pushUpdate(share)}
              onRemove={() => void removeOne(share)}
            />
          ))}
        </div>
      )}

      <OneTimeLinksSection />
    </div>
  );
}
