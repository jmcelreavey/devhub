import { runtimeThemeAssetUrl, type PublicRuntimeTheme } from "../../../../packages/shared/ui-lib/plugins/runtime-theme-contract";

/** Default DevHub Shift Dock mark — bump `v` when the asset changes so caches drop the old one. */
const DEFAULT_BRAND_IMAGE = "/brand-mark-dark.svg?v=6";
const DEFAULT_BRAND_LABEL = "DevHub";

/** Default mark shown in the sidebar, mobile top bar and boot screen. */
export const BRAND_BOTTLE_IMAGE_SRC = DEFAULT_BRAND_IMAGE;

/** Wordmark text shown next to the brand mark. */
export const BRAND_LABEL = DEFAULT_BRAND_LABEL;

/** The stock DevHub Shift Dock mark. */
export const DEVHUB_BRAND_IMAGE = DEFAULT_BRAND_IMAGE;

/** The DevHub wordmark. */
export const DEVHUB_BRAND_LABEL = DEFAULT_BRAND_LABEL;

/** No checkout branding is installed. */
export const HAS_PLUGIN_BRAND = false;

export function hollowBrandAssetUrl(theme: PublicRuntimeTheme, mode: "dark" | "light"): string | undefined {
  if (theme.id !== "hollow" || !theme.logo) return undefined;
  const asset = mode === "light" && theme.images?.some(image => image.id === "brand-light") ? "image:brand-light" : "logo";
  return runtimeThemeAssetUrl(theme, asset);
}

/** Matches IconPicker's `devhub-logo-icon` sentinels. */
const LOGO_STORAGE_KEY = "devhub-logo-icon";
const LOGO_PLUGIN_SENTINEL = "__bottle__";

/**
 * Blocking `<head>` script — same FOUC pattern as the theme bootstrap.
 *
 * SSR cannot read localStorage, so the boot overlay used to paint the plugin
 * plugin mark whenever a branding plugin was installed, then swap after hydrate.
 * This runs during HTML parse, before body, and sets `data-logo` on `<html>`:
 * `__bottle__` is the historical key for the plugin brand; anything else
 * (including no key) is the DevHub Shift Dock mark.
 */
export function getLogoBootstrapInlineScript(): string {
  const key = JSON.stringify(LOGO_STORAGE_KEY);
  const pluginSentinel = JSON.stringify(LOGO_PLUGIN_SENTINEL);
  const hasPlugin = false;
  return `(function(){try{var k=localStorage.getItem(${key});var root=document.documentElement;if(${hasPlugin}&&k===${pluginSentinel}){root.setAttribute("data-logo","plugin");}else{root.setAttribute("data-logo","devhub");}}catch(e){document.documentElement.setAttribute("data-logo","devhub");}})();`;
}

/** Keep `<html data-logo>` in sync after the user changes the picker (no reload). */
export function applyLogoChoice(stored: string | null): void {
  if (typeof document === "undefined") return;
  const usePlugin = HAS_PLUGIN_BRAND && stored === LOGO_PLUGIN_SENTINEL;
  document.documentElement.setAttribute("data-logo", usePlugin ? "plugin" : "devhub");
}
