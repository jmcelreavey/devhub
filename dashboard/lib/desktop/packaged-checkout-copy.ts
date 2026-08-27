/**
 * Copy for the "bundle is behind your checkout" nudge.
 *
 * Client-safe on purpose: `bundle-source.ts` pulls in `node:child_process`, so
 * the banner can only take types from it. These strings were living in three
 * places — the status payload's `reason`, the banner's own markup, and
 * `scripts/devhub-ship.sh` — and had already started to differ.
 *
 * `devhub-ship.sh` still carries its own copy because it is bash; keep it in
 * step with the constants here.
 */

export const REBUILD_MENU_PATH = "View → Rebuild Dashboard…";
export const ATTACH_MENU_PATH = "View → Attach to Dev Server…";

export const PACKAGED_STALE_REASON =
  "Your linked checkout is ahead of the dashboard baked into this app. Rebuild to copy it in, or attach to a dev server for hot reload.";
