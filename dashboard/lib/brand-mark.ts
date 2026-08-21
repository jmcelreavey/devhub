import { PLUGIN_BRAND_LOGO } from "./plugin-branding.generated";

/** Default DevHub bottle mark — bump `v` if the asset is replaced and caches should bust. */
const DEFAULT_BRAND_IMAGE = "/brand-bottle-photo-transparent.png?v=4";
const DEFAULT_BRAND_LABEL = "DevHub";

/**
 * Brand image shown in the sidebar chip, mobile top bar, and boot screen. A branding
 * plugin can seed its own default; the user can still override it in the IconPicker
 * (this only changes the out-of-box default, never forces a choice).
 */
export const BRAND_BOTTLE_IMAGE_SRC = PLUGIN_BRAND_LOGO?.src ?? DEFAULT_BRAND_IMAGE;

/** Wordmark text shown next to the brand mark (whitelabelled by a branding plugin). */
export const BRAND_LABEL = PLUGIN_BRAND_LOGO?.label ?? DEFAULT_BRAND_LABEL;

/** The stock DevHub bottle mark, always available even when a plugin brand is active —
 *  so the IconPicker can offer "switch back to the DevHub default". */
export const DEVHUB_BRAND_IMAGE = DEFAULT_BRAND_IMAGE;

/** The DevHub wordmark, regardless of any active whitelabel. */
export const DEVHUB_BRAND_LABEL = DEFAULT_BRAND_LABEL;

/** True when a branding plugin has supplied its own logo (i.e. we're whitelabelled). */
export const HAS_PLUGIN_BRAND = PLUGIN_BRAND_LOGO != null;

/** Matches IconPicker's `devhub-logo-icon` sentinels. */
const LOGO_STORAGE_KEY = "devhub-logo-icon";
const LOGO_PLUGIN_SENTINEL = "__bottle__";

/**
 * Blocking `<head>` script — same FOUC pattern as the theme bootstrap.
 *
 * SSR cannot read localStorage, so the boot overlay used to paint the plugin
 * mark (BI) whenever a branding plugin was installed, then swap after hydrate.
 * This runs during HTML parse, before body, and sets `data-logo` on `<html>`:
 * `__bottle__` → plugin; anything else (including no key) → DevHub bottle.
 */
export function getLogoBootstrapInlineScript(): string {
  const key = JSON.stringify(LOGO_STORAGE_KEY);
  const pluginSentinel = JSON.stringify(LOGO_PLUGIN_SENTINEL);
  const hasPlugin = PLUGIN_BRAND_LOGO != null;
  return `(function(){try{var k=localStorage.getItem(${key});var root=document.documentElement;if(${hasPlugin}&&k===${pluginSentinel}){root.setAttribute("data-logo","plugin");}else{root.setAttribute("data-logo","devhub");}}catch(e){document.documentElement.setAttribute("data-logo","devhub");}})();`;
}

/** Keep `<html data-logo>` in sync after the user changes the picker (no reload). */
export function applyLogoChoice(stored: string | null): void {
  if (typeof document === "undefined") return;
  const usePlugin = HAS_PLUGIN_BRAND && stored === LOGO_PLUGIN_SENTINEL;
  document.documentElement.setAttribute("data-logo", usePlugin ? "plugin" : "devhub");
}
