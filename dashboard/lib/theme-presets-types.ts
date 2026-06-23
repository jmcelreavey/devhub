/**
 * Structural types for theme presets, split out so generated plugin-branding code can
 * describe presets without importing the core `theme-presets.ts` module (avoids a cycle).
 */
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
}
