import type { PluginThemeEffects } from "./effects-types.ts";
import type { ThemeAvailability } from "./availability-types.ts";

export type ThemeMode = "dark" | "light";

/** A theme-preset descriptor as consumed by the AccentPicker swatch list. */
export interface ThemePresetMeta {
  id: string;
  label: string;
  description: string;
  /** Hex swatch shown for the dark variant. */
  darkSwatch: string;
  /** Hex swatch shown for the light variant. */
  lightSwatch: string;
  darkAccent?: string;
  lightAccent?: string;
  availability?: ThemeAvailability;
  /** Declarative controls; the plugin supplies CSS using data-theme-fx-* flags. */
  effects?: PluginThemeEffects;
}
