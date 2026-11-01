export type EffectGroup = "Atmosphere" | "Feedback" | "Pointer" | "Extras";

export interface ThemeEffectDeclaration {
  id: string;
  label: string;
  description: string;
  default: boolean;
  group: EffectGroup;
  reducedMotion: "static" | "off" | "unchanged";
  requires?: readonly string[];
}

export interface PluginThemeEffects {
  title: string;
  description: string;
  mark: "dock" | "hollow" | "ember" | "sonar" | "lantern" | "petal" | "brand";
  taskMessage: string;
  mergeMessage: string;
  effects: readonly ThemeEffectDeclaration[];
}

/** Plugin storage and events are assigned by the host, separately for each preset. */
export interface ThemeEffectsDeclaration extends PluginThemeEffects {
  storageKey: string;
  event: string;
}

export interface ThemeEffectPreferences { [id: string]: boolean }
