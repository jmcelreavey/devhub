/**
 * Which anchor clicks should become a workspace tab instead of a browser tab.
 *
 * Next's `<Link>` deliberately ignores modified clicks and lets the browser
 * handle them — which is why Shift/⌘-clicking "PRs" in the sidebar used to
 * throw a whole browser window at you instead of opening a tab in here. In the
 * packaged app that is worse still: the webview has no new-tab story at all.
 *
 * Mirror of `externalHref` in `components/shell/ExternalLinks.tsx`, which does
 * the same job for links pointing off-origin. The two are complementary — one
 * returns null wherever the other returns a href.
 *
 * Pure and DOM-shaped rather than React-shaped so the rules are testable
 * without mounting the shell.
 */

/** Set `data-no-tab-intercept` on an anchor (or an ancestor) to opt out. */
export const NO_TAB_INTERCEPT_ATTR = "data-no-tab-intercept";

interface ClickLike {
  type: string;
  button: number;
  defaultPrevented: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
}

/**
 * True when the click asked for "somewhere else": Shift, ⌘/Ctrl, or middle-click.
 *
 * Alt is excluded — on most platforms Alt-click means "download this", which is
 * a browser job, not ours.
 */
function wantsNewTab(event: ClickLike): boolean {
  if (event.altKey) return false;
  if (event.type === "auxclick") return event.button === 1;
  if (event.button !== 0) return false;
  return event.shiftKey || event.metaKey || event.ctrlKey;
}

/**
 * The in-app href this click should open in a new workspace tab, or null to
 * leave the event alone.
 *
 * Returns a root-relative href (path + search) so it matches what the tab
 * state stores.
 */
export function workspaceTabHrefFromClick(event: ClickLike, origin: string): string | null {
  if (event.defaultPrevented) return null;
  if (!wantsNewTab(event)) return null;

  const anchor = (event.target as Element | null)?.closest?.("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  // A download is a file, not a destination.
  if (anchor.hasAttribute("download")) return null;
  if (anchor.closest(`[${NO_TAB_INTERCEPT_ATTR}]`)) return null;
  // A bare `#anchor` scrolls the page it is already on; a new tab would only
  // lose the position it was pointing at.
  if (anchor.getAttribute("href")?.startsWith("#")) return null;

  let url: URL;
  try {
    url = new URL(anchor.href, origin);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // Off-origin links belong to ExternalLinks / the system browser.
  if (url.origin !== origin) return null;

  return `${url.pathname}${url.search}`;
}
