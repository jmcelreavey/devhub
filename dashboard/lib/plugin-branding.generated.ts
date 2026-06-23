/**
 * GENERATED — machine-local plugin branding.
 *
 * This file is rewritten by `lib/plugins/branding.ts` (run via `sync_plugins`) from the
 * `branding` block of whichever enabled plugin declares one, then marked
 * `git update-index --skip-worktree` so local whitelabel state never shows as repo churn.
 *
 * The committed version below is the *empty* baseline (no branding plugin) so a fresh
 * clone, typecheck and CI build all work without running sync first. Do not edit by hand.
 */
import type { ThemePresetMeta } from "./theme-presets-types";

export interface PluginBrandLogo {
  /** Public URL of the brand image, e.g. "/plugin-brand-logo.svg?v=1". */
  src: string;
  /** Accessible label, e.g. "BI". */
  label: string;
}

/** Extra theme presets contributed by the active branding plugin. */
export const PLUGIN_THEME_PRESETS: ThemePresetMeta[] = [];

/** Preset id seeded as the default, or null to keep the core default. */
export const PLUGIN_DEFAULT_PRESET: string | null = null;

/** Default colour mode seeded on first run, or null to keep the core default. */
export const PLUGIN_DEFAULT_MODE: "dark" | "light" | "system" | null = null;

/** Default sidebar/boot brand mark, or null to keep the core DevHub bottle. */
export const PLUGIN_BRAND_LOGO: PluginBrandLogo | null = null;
