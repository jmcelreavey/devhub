/**
 * Hollow — horror preset. Palette tokens live in globals.css; this module is
 * the toggle state, the October default, and the rules for what is allowed to
 * move. The effects bundle mounts only when the preset is actually selected.
 */

export const HOLLOW_PRESET_ID = "hollow";

export const HOLLOW_EFFECTS_KEY = "devhub:hollow-effects";
export const HOLLOW_PREVIEW_KEY = "devhub:hollow-preview";
export const HOLLOW_EFFECTS_EVENT = "devhub:hollow-effects";
export const HOLLOW_SOUND_GESTURE = "devhub:hollow-sound-gesture";

/**
 * The entire atmosphere shares one opacity, even at the corners. Tests put
 * both pure black and pure white over foreground and background at this
 * alpha, bounding shadows AND light/fog/grain at their simultaneous peak.
 */
export const HOLLOW_CONTENT_VEIL = 0.18;

export interface HollowEffects {
  master: boolean;
  atmosphere: boolean;
  creatures: boolean;
  interaction: boolean;
  rareEvents: boolean;
  jumpScares: boolean;
  sound: boolean;
}

export const HOLLOW_EFFECT_DEFAULTS: HollowEffects = {
  master: true,
  atmosphere: true,
  creatures: true,
  interaction: true,
  rareEvents: true,
  jumpScares: false,
  sound: false,
};

const HOLLOW_ATTRS = [
  "data-hollow-fx",
  "data-hollow-atmosphere",
  "data-hollow-creatures",
  "data-hollow-interaction",
  "data-hollow-jump",
  "data-hollow-sound",
  "data-hollow-preview",
  "data-hollow-paused",
] as const;

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function parseHollowEffects(raw: string | null | undefined): HollowEffects {
  if (!raw) return { ...HOLLOW_EFFECT_DEFAULTS };
  try {
    const parsed = JSON.parse(raw) as Partial<HollowEffects>;
    if (!parsed || typeof parsed !== "object") return { ...HOLLOW_EFFECT_DEFAULTS };
    return {
      master: bool(parsed.master, HOLLOW_EFFECT_DEFAULTS.master),
      atmosphere: bool(parsed.atmosphere, HOLLOW_EFFECT_DEFAULTS.atmosphere),
      creatures: bool(parsed.creatures, HOLLOW_EFFECT_DEFAULTS.creatures),
      interaction: bool(parsed.interaction, HOLLOW_EFFECT_DEFAULTS.interaction),
      rareEvents: bool(parsed.rareEvents, HOLLOW_EFFECT_DEFAULTS.rareEvents),
      jumpScares: bool(parsed.jumpScares, HOLLOW_EFFECT_DEFAULTS.jumpScares),
      sound: bool(parsed.sound, HOLLOW_EFFECT_DEFAULTS.sound),
    };
  } catch {
    return { ...HOLLOW_EFFECT_DEFAULTS };
  }
}

export interface HollowStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readHollowEffects(storage: Pick<HollowStorage, "getItem">): HollowEffects {
  return parseHollowEffects(storage.getItem(HOLLOW_EFFECTS_KEY));
}

export function writeHollowEffects(storage: HollowStorage, effects: HollowEffects): void {
  storage.setItem(HOLLOW_EFFECTS_KEY, JSON.stringify(effects));
}

/** Master off forces every layer off, even if a sub-toggle was left on. */
export function hollowDataFlags(effects: HollowEffects): Record<string, "on" | "off"> {
  const master = effects.master;
  const on = (enabled: boolean) => (master && enabled ? "on" : "off");
  return {
    "data-hollow-fx": master ? "on" : "off",
    "data-hollow-atmosphere": on(effects.atmosphere),
    "data-hollow-creatures": on(effects.creatures),
    "data-hollow-interaction": on(effects.interaction),
    "data-hollow-jump": on(effects.jumpScares),
    "data-hollow-sound": on(effects.sound),
  };
}

export interface HollowRuntimePlan {
  mount: boolean;
  grain: boolean;
  grainMotion: boolean;
  creatures: boolean;
  cracks: boolean;
  glitch: boolean;
  buttonGlow: boolean;
  cursorTrail: boolean;
  rareEvents: boolean;
  jumpScares: boolean;
  sound: boolean;
}

/**
 * Reduced motion keeps static textures (grain, vignette, stains, a still
 * crack on hover). Flicker, drifting, creatures, glitch, the cursor trail,
 * and jump scares stay off. Sound is not motion; it still requires its toggle.
 */
export function hollowRuntimePlan(effects: HollowEffects, motion: boolean): HollowRuntimePlan {
  const master = effects.master;
  const atmosphere = master && effects.atmosphere;
  const interaction = master && effects.interaction;
  const creatures = master && effects.creatures && motion;
  const jumpScares = master && effects.jumpScares && motion;
  const sound = master && effects.sound;
  return {
    mount: atmosphere || creatures || interaction || jumpScares || sound,
    grain: atmosphere,
    grainMotion: atmosphere && motion,
    creatures,
    cracks: interaction,
    glitch: interaction && motion,
    buttonGlow: interaction && motion,
    cursorTrail: interaction && motion,
    rareEvents: atmosphere && creatures && effects.rareEvents,
    jumpScares,
    sound,
  };
}

export function shouldMountHollowRuntime(preset: string, effects: HollowEffects, motion: boolean): boolean {
  return preset === HOLLOW_PRESET_ID && hollowRuntimePlan(effects, motion).mount;
}

export function hollowMotionAllowed(reducedMotion: boolean, motionKilled: boolean): boolean {
  return !reducedMotion && !motionKilled;
}

export function applyHollowDom(
  root: HTMLElement,
  preset: string,
  effects: HollowEffects,
  preview: boolean,
): void {
  if (preset !== HOLLOW_PRESET_ID || !effects.master) {
    for (const attr of HOLLOW_ATTRS) root.removeAttribute(attr);
    return;
  }
  const flags = hollowDataFlags(effects);
  for (const [attr, value] of Object.entries(flags)) root.setAttribute(attr, value);
  if (preview) root.setAttribute("data-hollow-preview", "on");
  else root.removeAttribute("data-hollow-preview");
}

/** Screenshot/test hook. Not linked from the UI. */
export function isHollowPreview(search: string, stored: string | null): boolean {
  if (stored === "1") return true;
  const query = search.startsWith("?") ? search.slice(1) : search;
  return new URLSearchParams(query).get("hollowPreview") === "1";
}

/** Freezes the jump-scare face for a screenshot. Not linked from the UI. */
export function isHollowFaceShot(search: string): boolean {
  const query = search.startsWith("?") ? search.slice(1) : search;
  return new URLSearchParams(query).get("hollowFace") === "1";
}

const BOO = ["b", "o", "o"] as const;

/** Returns the next index, or "trigger" when the word completes. */
export function advanceBoo(index: number, key: string): number | "trigger" {
  const pressed = key.toLowerCase();
  const expected = BOO[index] ?? BOO[0];
  if (pressed !== expected) return pressed === "b" ? 1 : 0;
  const next = index + 1;
  return next >= BOO.length ? "trigger" : next;
}

export const HOLLOW_SEASON_KEY = "devhub:hollow-season";

export interface HollowSeasonSelection {
  preset: string;
  mode: "dark" | "light" | "system";
}

export interface HollowSeasonState {
  year: number;
  previous: HollowSeasonSelection | null;
  overridden: boolean;
  restored: boolean;
}

/** Validate persisted data before either bootstrap or React uses it. */
export function parseHollowSeason(raw: string | null, presets: readonly string[]): HollowSeasonState | null {
  try {
    const value = JSON.parse(raw ?? "null") as HollowSeasonState | null;
    if (!value || !Number.isInteger(value.year) || value.year < 1 || value.year > 9999
      || typeof value.overridden !== "boolean" || typeof value.restored !== "boolean") return null;
    const previous = value.previous;
    if (previous !== null && (!previous || !presets.includes(previous.preset)
      || !["dark", "light", "system"].includes(previous.mode))) return null;
    return { year: value.year, previous, overridden: value.overridden, restored: value.restored };
  } catch {
    return null;
  }
}

/** Local calendar policy. Kept self-contained so the same function runs before paint. */
export function resolveHollowSeason(
  date: Date,
  current: HollowSeasonSelection,
  saved: HollowSeasonState | null,
): { selection: HollowSeasonSelection; state: HollowSeasonState | null } {
  const year = date.getFullYear();
  const october = date.getMonth() === 9;
  let selection = current;
  let state = saved;
  if (state && (!october || state.year !== year) && !state.restored) {
    const stillAutomatic = selection.preset === "hollow";
    if (state.previous && !state.overridden && stillAutomatic) {
      selection = { ...selection, preset: state.previous.preset };
    }
    state = { ...state, restored: true };
  }
  if (october && (!state || state.year !== year)) {
    state = { year, previous: selection.preset === "hollow" ? null : { ...selection },
      overridden: false, restored: false };
    selection = { ...selection, preset: "hollow" };
  }
  return { selection, state };
}

export function overrideHollowSeason(date: Date, state: HollowSeasonState | null): HollowSeasonState | null {
  return state && state.year === date.getFullYear() && date.getMonth() === 9
    ? { ...state, overridden: true } : state;
}

/** Embedded into the theme bootstrap with its already-sanitised preset and mode. */
export function getHollowSeasonBootstrapScript(presets: readonly string[]): string {
  return `var seasonal=(${resolveHollowSeason.toString()})((${parseHollowNow.toString()})(window.location.search,new Date()),{preset:preset,mode:setting},(${parseHollowSeason.toString()})(localStorage.getItem("${HOLLOW_SEASON_KEY}"),${JSON.stringify(presets)}));preset=seasonal.selection.preset;setting=seasonal.selection.mode;try{if(seasonal.state)localStorage.setItem("${HOLLOW_SEASON_KEY}",JSON.stringify(seasonal.state));localStorage.setItem(p,preset);localStorage.setItem(m,setting);}catch(e){}`;
}

/** `YYYY-MM-DD` in local time, for the `?hollowNow=` screenshot/test hook. */
export function parseHollowNow(search: string, fallback: Date): Date {
  const query = search.startsWith("?") ? search.slice(1) : search;
  const raw = new URLSearchParams(query).get("hollowNow");
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return fallback;
  const [year, month, day] = raw.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return fallback;
  }
  return date;
}

/**
 * Runs after the theme bootstrap has set `data-theme-preset`. Sets Hollow
 * effect attributes before first paint, and removes them for every other preset
 * so a stale attribute cannot leak.
 */
export function getHollowAttributeBootstrapScript(): string {
  const preset = JSON.stringify(HOLLOW_PRESET_ID);
  const key = JSON.stringify(HOLLOW_EFFECTS_KEY);
  const attrs = JSON.stringify(HOLLOW_ATTRS);
  return `(function(){try{var root=document.documentElement;var preset=root.getAttribute("data-theme-preset");var attrs=${attrs};var fx={};try{fx=JSON.parse(localStorage.getItem(${key})||"")||{};}catch(e){fx={};}if(preset!==${preset}||fx.master===false){for(var i=0;i<attrs.length;i++)root.removeAttribute(attrs[i]);return;}var master=true;function on(v,d){return master&&(typeof v==="boolean"?v:d)?"on":"off";}root.setAttribute("data-hollow-fx","on");root.setAttribute("data-hollow-atmosphere",on(fx.atmosphere,true));root.setAttribute("data-hollow-creatures",on(fx.creatures,true));root.setAttribute("data-hollow-interaction",on(fx.interaction,true));root.setAttribute("data-hollow-jump",on(fx.jumpScares,false));root.setAttribute("data-hollow-sound",on(fx.sound,false));}catch(e){}})();`;
}
