"use client";

import { X } from "lucide-react";
import { useCallback, useState } from "react";
import { useLive } from "@/lib/hooks/use-fetch";
import type { PackagedCheckoutStatus } from "@/lib/desktop/bundle-source";
import {
  ATTACH_MENU_PATH,
  PACKAGED_STALE_REASON,
  REBUILD_MENU_PATH,
} from "@/lib/desktop/packaged-checkout-copy";

const DISMISS_PREFIX = "devhub-packaged-checkout-banner-dismissed:";

/**
 * `localStorage` throws outright in some contexts (Safari private mode,
 * "block all cookies"), and an unguarded read in render takes the page with it.
 */
function readDismissed(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(key: string): void {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    /* nothing to do — the banner just comes back next launch */
  }
}

/**
 * Derived, not synchronised.
 *
 * This was a `useSyncExternalStore` over `localStorage` plus a bespoke window
 * event whose only listener was itself — machinery for a store with one reader.
 * The flag is just a function of `key`, so read it during render and re-render
 * once on dismiss. A new key (new checkout commit) is a new nudge, and falls
 * out of the derivation for free instead of needing an effect to resync.
 */
function useDismissed(key: string | null): [boolean, () => void] {
  const [dismissedThisSession, setDismissedThisSession] = useState<string | null>(null);

  const dismiss = useCallback(() => {
    if (!key) return;
    writeDismissed(key);
    setDismissedThisSession(key);
  }, [key]);

  // Session state first, so dismiss still works when the write was rejected
  // (private mode) — otherwise the banner would reappear on the next poll.
  const dismissed = key !== null && (dismissedThisSession === key || readDismissed(key));

  return [dismissed, dismiss];
}

/**
 * Nudge after ship/pull: the .app still serves the bundled dashboard until
 * Rebuild or Attach to Dev Server. Deliberately a banner, not a modal.
 *
 * The two routes out are named as menu paths rather than rendered as buttons —
 * both are native shell menu items with no bridge command behind them, and a
 * button that cannot do the thing is worse than a sentence that says where it
 * is. Wire them up here if a Tauri command ever lands.
 */
export function PackagedCheckoutBanner() {
  const { data } = useLive<PackagedCheckoutStatus>("/api/status/packaged-checkout", {
    refreshInterval: 120_000,
  });
  // `stale` already implies both commits are known; the key just names the pair.
  const dismissKey = data?.stale
    ? `${DISMISS_PREFIX}${data.bundleCommit}->${data.checkoutCommit}`
    : null;
  const [dismissed, dismiss] = useDismissed(dismissKey);

  if (!data?.packagedRuntime || !data.stale || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="packaged-checkout-banner"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        flexWrap: "wrap",
        padding: "10px 14px",
        borderBottom: "1px solid var(--border)",
        background: "color-mix(in srgb, var(--warning, #c9a227) 10%, var(--bg-elevated))",
        fontSize: "13px",
      }}
    >
      <div style={{ flex: 1, minWidth: "220px" }}>
        <strong>Dashboard bundle is behind your checkout.</strong>{" "}
        <span style={{ color: "var(--text-subtle)" }}>
          {data.reason ?? PACKAGED_STALE_REASON} Use <code>{REBUILD_MENU_PATH}</code> or{" "}
          <code>{ATTACH_MENU_PATH}</code>.
        </span>
      </div>
      <button
        type="button"
        className="hub-icon-btn"
        aria-label="Dismiss until checkout and bundle match again"
        onClick={dismiss}
        style={{ flexShrink: 0 }}
      >
        <X size={14} />
      </button>
    </div>
  );
}
