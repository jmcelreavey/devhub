"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Flame, Loader2, Copy, Check, X } from "lucide-react";
import { useToast } from "@/lib/hooks/use-toast";
import { copyTextToClipboard } from "@/lib/clipboard";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import type { OneTimeRecord, VaultId } from "@/lib/share/share-public";

type Expiry = "1hour" | "1day" | "1week";

const EXPIRY_OPTIONS: { value: Expiry; label: string }[] = [
  { value: "1hour", label: "1 hour" },
  { value: "1day", label: "1 day" },
  { value: "1week", label: "1 week" },
];

interface Props {
  vaultId: VaultId;
  path: string;
  /** Called after a successful publish so a list elsewhere can refresh. */
  onCreated?: () => void;
  /** Hide the Flame trigger — open via `open` / `onOpenChange` (e.g. overflow menu). */
  hideTrigger?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface Created {
  share: OneTimeRecord;
  passphrase: string;
}

/**
 * Publish the current note as a burn-after-reading PrivateBin link.
 *
 * Kept separate from {@link ShareControls} because the two do genuinely
 * different things: a gist share is a link you keep updated, this is a link
 * that destroys itself. Folding them into one control produced a menu where
 * half the actions were disabled half the time.
 */
export function OneTimeShareButton({
  vaultId,
  path,
  onCreated,
  hideTrigger = false,
  open: openProp,
  onOpenChange,
}: Props) {
  const toast = useToast();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      onOpenChange?.(next);
      if (openProp === undefined) setUncontrolledOpen(next);
    },
    [onOpenChange, openProp],
  );
  const [busy, setBusy] = useState(false);
  const [expire, setExpire] = useState<Expiry>("1day");
  const [withPassword, setWithPassword] = useState(true);
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState<"link" | "password" | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape, but never while a request is in flight —
  // losing the panel mid-publish would lose the passphrase with it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (busy) return;
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, busy, setOpen]);

  const reset = () => {
    setCreated(null);
    setCopied(null);
    setOpen(false);
  };

  const publish = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/share/one-time", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vault: vaultId, path, password: withPassword, expire }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<Created> & { error?: string };
      if (!res.ok || !body.share) throw new Error(body.error ?? res.statusText);
      setCreated({ share: body.share, passphrase: body.passphrase ?? "" });
      onCreated?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create a one-time link.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (what: "link" | "password", value: string) => {
    try {
      await copyTextToClipboard(value);
      setCopied(what);
      setTimeout(() => setCopied((c) => (c === what ? null : c)), 1_500);
    } catch {
      toast.error("Could not copy.");
    }
  };

  return (
    <div
      className={
        hideTrigger
          ? "pointer-events-none absolute right-0 top-0 h-full w-0 overflow-visible"
          : "relative shrink-0"
      }
      ref={containerRef}
    >
      {!hideTrigger ? (
        <button
          type="button"
          onClick={() => (open ? reset() : setOpen(true))}
          title="Create a one-time link that self-destructs when opened"
          className="btn btn-ghost text-xs flex items-center gap-1"
          aria-expanded={open}
        >
          <Flame size={14} aria-hidden />
          One-time
        </button>
      ) : null}

      {open ? (
        <div
          className="card absolute right-0 z-50 mt-1 pointer-events-auto"
          style={{ top: "100%", width: 320, padding: 12 }}
          role="dialog"
          aria-label="Create a one-time link"
        >
          {created ? (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-medium">Link ready</div>
                <button
                  type="button"
                  onClick={reset}
                  className="btn btn-ghost text-xs flex items-center justify-center px-1"
                  aria-label="Close"
                >
                  <X size={13} aria-hidden />
                </button>
              </div>

              <p className="text-xs text-text-subtle">
                Destroyed the first time it is opened. Send the password separately — not in
                the same message as the link.
              </p>

              <div className="space-y-1">
                <div className="text-xs text-text-muted">Link</div>
                <div className="flex items-center gap-1">
                  <code
                    className="text-xs truncate flex-1 px-1.5 py-1"
                    style={{ background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)" }}
                  >
                    {created.share.url}
                  </code>
                  <button
                    type="button"
                    onClick={() => void copy("link", created.share.url)}
                    className="btn btn-ghost text-xs flex items-center justify-center px-1.5"
                    aria-label="Copy link"
                  >
                    {copied === "link" ? (
                      <Check size={13} style={{ color: "var(--success)" }} aria-hidden />
                    ) : (
                      <Copy size={13} aria-hidden />
                    )}
                  </button>
                </div>
              </div>

              {created.passphrase ? (
                <div className="space-y-1">
                  <div className="text-xs text-text-muted">Password — shown once</div>
                  <div className="flex items-center gap-1">
                    <code
                      className="text-xs flex-1 px-1.5 py-1"
                      style={{ background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)" }}
                    >
                      {created.passphrase}
                    </code>
                    <button
                      type="button"
                      onClick={() => void copy("password", created.passphrase)}
                      className="btn btn-ghost text-xs flex items-center justify-center px-1.5"
                      aria-label="Copy password"
                    >
                      {copied === "password" ? (
                        <Check size={13} style={{ color: "var(--success)" }} aria-hidden />
                      ) : (
                        <Copy size={13} aria-hidden />
                      )}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-sm font-medium">One-time link</div>
              <p className="text-xs text-text-subtle">
                Encrypted before it leaves this machine and destroyed when first opened. The
                recipient gets one shot at reading it.
              </p>

              <div className="space-y-1">
                <div className="text-xs text-text-muted">Expires after</div>
                <ToggleGroup
                  options={EXPIRY_OPTIONS}
                  value={expire}
                  onChange={setExpire}
                  aria-label="Link expiry"
                />
              </div>

              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={withPassword}
                  onChange={(e) => setWithPassword(e.target.checked)}
                />
                Protect with a generated password
              </label>

              <button
                type="button"
                disabled={busy}
                onClick={publish}
                className="btn btn-primary text-xs w-full flex items-center justify-center gap-1"
              >
                {busy ? <Loader2 size={13} className="animate-spin" aria-hidden /> : null}
                Create link
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
