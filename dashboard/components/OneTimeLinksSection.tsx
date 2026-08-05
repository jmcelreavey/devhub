"use client";

import { useState } from "react";
import Link from "next/link";
import { Flame, Copy, Trash2, Lock, Unlock } from "lucide-react";
import { useLive } from "@/lib/hooks/use-fetch";
import { useToast } from "@/lib/hooks/use-toast";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useConfirm } from "@/components/shell/ConfirmDialog";
import { getVaultClient } from "@/lib/vault/vault-client";
import type { OneTimeRecord } from "@/lib/share/share-public";

/** "in 4 hours" / "in 3 days" — coarse on purpose; these are short-lived. */
function remainingLabel(record: OneTimeRecord, now = Date.now()): string {
  const ms = record.expiresAt - now;
  if (ms <= 0) return "Expired";
  const hours = Math.ceil(ms / (60 * 60 * 1000));
  if (hours < 24) return `Expires in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.ceil(hours / 24);
  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
}

/**
 * One-time links on `/shared`.
 *
 * Note what is deliberately absent: no Stale badge, no Update button, no "open"
 * link. There is nothing to update — the paste is immutable — and opening it
 * from here would burn the recipient's only read.
 */
export function OneTimeLinksSection() {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, mutate } = useLive<{ shares: OneTimeRecord[] }>("/api/share/one-time");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const shares = data?.shares ?? [];

  const revoke = async (record: OneTimeRecord) => {
    setBusyId(record.id);
    try {
      const res = await fetch("/api/share/one-time", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: record.id }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? res.statusText);
      }
      await mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not revoke.");
    } finally {
      setBusyId(null);
    }
  };

  const revokeAll = async () => {
    const ok = await confirm({
      title: "Revoke all one-time links",
      message: `Destroy all ${shares.length} unread link${shares.length === 1 ? "" : "s"}? Anyone holding one will get a dead link.`,
      confirmLabel: "Revoke all",
      variant: "danger",
    });
    if (!ok) return;
    setClearing(true);
    try {
      const res = await fetch("/api/share/one-time?all=1", { method: "DELETE" });
      if (!res.ok) throw new Error(res.statusText);
      await mutate();
      toast.success("All one-time links revoked.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not revoke all.");
    } finally {
      setClearing(false);
    }
  };

  if (shares.length === 0) return null;

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium">One-time links</div>
          <span className="badge badge-muted">{shares.length}</span>
        </div>
        <button
          type="button"
          className="btn btn-danger-ghost"
          style={{ fontSize: "12px", padding: "4px 10px" }}
          onClick={revokeAll}
          disabled={clearing}
        >
          <Trash2 size={12} aria-hidden /> Revoke all
        </button>
      </div>

      <p className="text-xs mb-3 text-text-subtle">
        Burn-after-reading links. DevHub cannot tell whether one has been opened — the
        server destroys it and reports to nobody. Revoking only works if it is still unread.
      </p>

      <div className="space-y-2">
        {shares.map((record) => (
          <div key={record.id} className="card flex items-center gap-3" style={{ padding: "10px 12px" }}>
            <Flame size={15} style={{ color: "var(--warning)", flexShrink: 0 }} aria-hidden />
            <div className="min-w-0 flex-1">
              <Link
                href={getVaultClient(record.vault).paths.pageHref(record.path)}
                className="text-sm font-medium hover:underline no-underline"
              >
                {record.title}
              </Link>
              <div className="text-xs truncate text-text-subtle">
                {record.vault} · {record.path}
              </div>
            </div>

            <span
              className="badge badge-muted text-xs shrink-0 flex items-center gap-1"
              title={record.hasPassword ? "Password protected" : "No password — the link alone opens it"}
            >
              {record.hasPassword ? <Lock size={11} aria-hidden /> : <Unlock size={11} aria-hidden />}
              {record.hasPassword ? "Password" : "Link only"}
            </span>

            <span
              className="badge badge-muted text-xs shrink-0"
              title={`Created ${new Date(record.createdAt).toLocaleString()}`}
            >
              {remainingLabel(record)}
            </span>

            <button
              type="button"
              onClick={() => {
                void copyTextToClipboard(record.url).then(
                  () => toast.success("Link copied."),
                  () => toast.error("Could not copy link."),
                );
              }}
              className="btn btn-ghost text-xs flex items-center justify-center px-1.5 shrink-0"
              aria-label="Copy link"
            >
              <Copy size={13} aria-hidden />
            </button>

            <button
              type="button"
              disabled={busyId === record.id}
              onClick={() => revoke(record)}
              className="btn btn-danger-ghost text-xs flex items-center justify-center px-1.5 shrink-0"
              aria-label="Revoke link"
            >
              <Trash2 size={13} aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
