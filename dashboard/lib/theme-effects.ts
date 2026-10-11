import { GRAPHITE_EFFECT_DEFAULTS } from "./graphite-theme";
import { HOLLOW_EFFECT_DEFAULTS } from "./hollow-theme";

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
export interface ThemeEffectsDeclaration {
  storageKey: string;
  event: string;
  title: string;
  description: string;
  mark: "dock" | "hollow" | "ember" | "sonar" | "lantern" | "petal";
  taskMessage: string;
  mergeMessage: string;
  effects: readonly ThemeEffectDeclaration[];
}
export interface ThemeEffectPreferences { [id: string]: boolean }

function effect(id: string, label: string, description: string, group: EffectGroup,
  reducedMotion: ThemeEffectDeclaration["reducedMotion"] = "off", defaultValue = true,
  requires?: readonly string[]): ThemeEffectDeclaration {
  return { id, label, description, group, reducedMotion, default: defaultValue, requires };
}

const graphiteEffects = [
  effect("glow", "Neon edges", "Lime light along the dock and active surfaces.", "Atmosphere", "static"),
  effect("grid", "Workshop grid", "A fine measuring grid behind your workspace.", "Atmosphere", "static"),
  effect("scanlines", "Ambient scan", "A light pass along the workspace edge.", "Atmosphere"),
  effect("loader", "Dock loader", "Shift Dock rails charge while the lime hub slides home.", "Feedback", "static"),
  effect("activity", "Activity pulse", "A soft pulse while agents and commands run.", "Feedback"),
  effect("interaction", "Hover & press", "A light sweep on hover and a short snap on press.", "Feedback", "static"),
  effect("celebrations", "Finishing touches", "A short dock salute for completed tasks and merged PRs.", "Feedback"),
  effect("emptyStates", "Empty-state arrival", "An idle dock settles into an empty panel.", "Feedback", "static"),
  effect("charts", "Chart arrival", "Bars and meters arrive without changing their values.", "Feedback", "static"),
  effect("cursor", "Cursor follower", "A soft lime ring; steps aside for editors and terminals.", "Pointer"),
].map(declaration => ({ ...declaration, default: GRAPHITE_EFFECT_DEFAULTS[declaration.id as keyof typeof GRAPHITE_EFFECT_DEFAULTS] }));

const hollowEffects = [
  effect("atmosphere", "Atmosphere", "Layered fog, guttering light, grain and bottle wisps.", "Atmosphere", "static"),
  effect("creatures", "Creatures", "Watching eyes, spiders and a shadow in the fog.", "Atmosphere"),
  effect("rareEvents", "Rare events", "A passing presence every few minutes.", "Extras", "off", true, ["atmosphere", "creatures"]),
  effect("interaction", "Interaction", "Cobweb sway, cracks and a heading glitch.", "Feedback", "static"),
  effect("loader", "Haunted mark", "A candlelit arch while content arrives.", "Feedback", "static"),
  effect("celebrations", "Sealed & settled", "A spectral seal for a completed task or merged PR.", "Feedback"),
  effect("cursor", "Spectral follower", "A spectral trail; steps aside while you type.", "Pointer"),
  effect("jumpScares", "Jump scares", "Opt in, then type boo outside a text field.", "Extras", "off", false),
  effect("sound", "Sound", "Opt-in drone. Starts on your click, pauses in hidden tabs.", "Extras", "unchanged", false),
].map(declaration => ({ ...declaration, default: HOLLOW_EFFECT_DEFAULTS[declaration.id as keyof typeof HOLLOW_EFFECT_DEFAULTS] }));

function signatureEffects(ambient: string, description: string, loader: string, interaction: string, cursor: string) {
  return [
    effect("ambient", ambient, description, "Atmosphere", "static"),
    effect("loader", loader, "A theme mark breathes while content arrives; still when idle.", "Feedback", "static"),
    effect("interaction", interaction, "A brief, theme-shaped response to hover and press.", "Feedback", "static"),
    effect("celebrations", "Completion mark", "A signature salute for completed tasks and merged PRs.", "Feedback"),
    effect("cursor", cursor, "A matching mouse follower; never replaces the native pointer.", "Pointer"),
  ];
}

export const THEME_EFFECTS: Readonly<Record<string, ThemeEffectsDeclaration>> = {
  graphite: { storageKey: "devhub:graphite-effects", event: "devhub:graphite-effects", title: "Neon workshop", description: "A little light. A lot getting done.", mark: "dock", taskMessage: "Done. One less loose end.", mergeMessage: "Merged. Nicely docked.", effects: graphiteEffects },
  hollow: { storageKey: "devhub:hollow-effects", event: "devhub:hollow-effects", title: "The haunted study", description: "Stained paper, spectral light. Sound and scares are opt-in.", mark: "hollow", taskMessage: "Done. Laid to rest.", mergeMessage: "Merged. The pact is sealed.", effects: hollowEffects },
  forest: { storageKey: "devhub:theme-effects:forest", event: "devhub:theme-effects", title: "Ember hearth", description: "Copper ink, warm paper and a banked fire.", mark: "ember", taskMessage: "Done. Another spark.", mergeMessage: "Merged. Forged together.", effects: signatureEffects("Hearth light", "Warm light pools at the edge of the workspace.", "Ember loader", "Copper press", "Ember follower") },
  midnight: { storageKey: "devhub:theme-effects:midnight", event: "devhub:theme-effects", title: "Deep-water observatory", description: "Ocean ink, blue glass and precise sonar rings.", mark: "sonar", taskMessage: "Done. Signal received.", mergeMessage: "Merged. Connection established.", effects: signatureEffects("Depth contours", "Still sonar contours frame the workspace, never the text.", "Sonar loader", "Signal response", "Sonar follower") },
  tokyo: { storageKey: "devhub:theme-effects:tokyo", event: "devhub:theme-effects", title: "After-hours studio", description: "Plum ink and a violet lantern, without the glare.", mark: "lantern", taskMessage: "Done. Lights out.", mergeMessage: "Merged. Lines connected.", effects: signatureEffects("Lantern light", "A violet wash lights the upper edge of the workspace.", "Lantern loader", "Lantern lift", "Lantern follower") },
  catppuccin: { storageKey: "devhub:theme-effects:catppuccin", event: "devhub:theme-effects", title: "Porcelain garden", description: "Celadon, cream and folded leaves. A quieter workspace.", mark: "petal", taskMessage: "Done. Room to grow.", mergeMessage: "Merged. A new leaf.", effects: signatureEffects("Garden light", "A soft celadon pool at the foot of the workspace.", "Unfolding loader", "Petal press", "Petal follower") },
};

export function themeEffectDefaults(preset: string, registry = THEME_EFFECTS): ThemeEffectPreferences {
  return Object.fromEntries([["master", true], ...(registry[preset]?.effects ?? []).map(declaration => [declaration.id, declaration.default])]);
}

export function parseThemeEffects(preset: string, raw: string | null, defaults = themeEffectDefaults(preset)): ThemeEffectPreferences {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
    const saved = value as Record<string, unknown>;
    for (const key of Object.keys(defaults)) {
      if (typeof saved[key] === "boolean") defaults[key] = saved[key];
    }
    if (preset === "hollow" && typeof saved.cursor !== "boolean" && typeof saved.interaction === "boolean") defaults.cursor = saved.interaction;
  } catch { return defaults; }
  return defaults;
}

export function effectEnabled(preset: string, preferences: ThemeEffectPreferences, id: string, motion: boolean, registry = THEME_EFFECTS): boolean {
  const declaration = registry[preset]?.effects?.find(effect => effect.id === id);
  return Boolean(declaration && preferences.master && preferences[id]
    && (motion || declaration.reducedMotion !== "off")
    && (declaration.requires ?? []).every(required => preferences[required]));
}

export function applyThemeEffectsDom(root: HTMLElement, preset: string, preferences: ThemeEffectPreferences, motion: boolean, registry = THEME_EFFECTS, enabled = effectEnabled): void {
  for (const attribute of root.getAttributeNames()) {
    if (attribute.startsWith("data-theme-fx-")) root.removeAttribute(attribute);
  }
  const effects = registry[preset]?.effects;
  if (!effects) return;
  root.setAttribute("data-theme-fx-master", preferences.master ? "on" : "off");
  root.setAttribute("data-theme-fx-motion", motion ? "on" : "off");
  for (const effect of effects) {
    root.setAttribute(`data-theme-fx-${effect.id.toLowerCase()}`, enabled(preset, preferences, effect.id, motion, registry) ? "on" : "off");
  }
}

export function getThemeEffectsBootstrapScript(): string {
  const registry = Object.fromEntries(Object.entries(THEME_EFFECTS).map(([preset, declaration]) => [preset, {
    storageKey: declaration.storageKey,
    effects: declaration.effects.map(({ id, default: defaultValue, reducedMotion, requires }) => ({ id, default: defaultValue, reducedMotion, requires })),
  }]));
  return `(function(){var registry=${JSON.stringify(registry)};var root=document.documentElement;var preset=root.getAttribute("data-theme-preset");var declaration=registry[preset];if(!declaration||!Array.isArray(declaration.effects))return;var raw=null;try{raw=localStorage.getItem(declaration.storageKey);}catch(e){}var defaults=(${themeEffectDefaults.toString()})(preset,registry);var enabled=${effectEnabled.toString()};var preferences=(${parseThemeEffects.toString()})(preset,raw,defaults);(${applyThemeEffectsDom.toString()})(root,preset,preferences,!window.matchMedia("(prefers-reduced-motion: reduce)").matches,registry,enabled);})();`;
}
