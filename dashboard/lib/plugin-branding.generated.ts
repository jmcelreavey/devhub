/* GENERATED from plugin "bi" branding - do not edit (see lib/plugins/branding.ts). */
import type { ThemePresetMeta } from "./theme-presets-types";

export interface PluginBrandLogo {
  src: string;
  label: string;
}

export const PLUGIN_THEME_PRESETS: ThemePresetMeta[] = [
  {
    "id": "bi",
    "label": "Business Insider",
    "description": "Black + electric blue · Garnett",
    "darkSwatch": "#121212",
    "lightSwatch": "#ffffff"
  }
];

export const PLUGIN_DEFAULT_PRESET: string | null = "bi";

export const PLUGIN_DEFAULT_MODE: "dark" | "light" | "system" | null = "system";

export const PLUGIN_BRAND_LOGO: PluginBrandLogo | null = { src: "/plugin-brand-logo.svg?v=1e567257", label: "" };
