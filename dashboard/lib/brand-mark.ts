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
