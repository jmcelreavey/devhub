/** Graphite's scenery never overlays content; light stays in surfaces and gutters. */
export const GRAPHITE_EFFECTS_KEY = "devhub:graphite-effects";
export const GRAPHITE_EFFECTS_EVENT = "devhub:graphite-effects";
export const GRAPHITE_CELEBRATE_EVENT = "devhub:graphite-celebrate";

export const GRAPHITE_EFFECT_DEFAULTS = {
  master: true,
  glow: true,
  grid: true,
  scanlines: true,
  loader: true,
  activity: true,
  interaction: true,
  celebrations: true,
  cursor: true,
  emptyStates: true,
  charts: true,
};

export type GraphiteEffect = keyof typeof GRAPHITE_EFFECT_DEFAULTS;
export type GraphiteEffects = Record<GraphiteEffect, boolean>;

export function parseGraphiteEffects(raw: string | null, defaults: GraphiteEffects = GRAPHITE_EFFECT_DEFAULTS): GraphiteEffects {
  const effects = { ...defaults };
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object") return effects;
    for (const key of Object.keys(effects) as GraphiteEffect[]) {
      const setting = (value as Record<string, unknown>)[key];
      if (typeof setting === "boolean") effects[key] = setting;
    }
  } catch {
    // A malformed preference must not prevent the dashboard from opening.
  }
  return effects;
}

export function applyGraphiteDom(root: HTMLElement, preset: string, effects: GraphiteEffects): void {
  for (const key of Object.keys(effects) as GraphiteEffect[]) {
    const attribute = `data-graphite-${key.toLowerCase()}`;
    if (preset !== "graphite") root.removeAttribute(attribute);
    else root.setAttribute(attribute, effects.master && effects[key] ? "on" : "off");
  }
}

/** Pass defaults explicitly: the embedded functions must survive production identifier minification. */
export function getGraphiteBootstrapScript(): string {
  return `(function(){var GRAPHITE_EFFECT_DEFAULTS=${JSON.stringify(GRAPHITE_EFFECT_DEFAULTS)};var raw=null;try{raw=localStorage.getItem("${GRAPHITE_EFFECTS_KEY}");}catch(e){}var fx=(${parseGraphiteEffects.toString()})(raw,GRAPHITE_EFFECT_DEFAULTS);(${applyGraphiteDom.toString()})(document.documentElement,document.documentElement.getAttribute("data-theme-preset"),fx);})();`;
}

// Shared by task rows: one merge moment per observed transition, never on first load.
const observedRuns = new Map<string, string>();
export function observeGraphiteMerge(run: { runId: string; prState?: string }): void {
  if (!run.prState) return;
  const previous = observedRuns.get(run.runId);
  observedRuns.set(run.runId, run.prState);
  if (observedRuns.size > 256) observedRuns.delete(observedRuns.keys().next().value!);
  if (previous && previous !== "merged" && run.prState === "merged") celebrateGraphite("merge");
}

export type GraphiteCelebration = "task" | "merge";
export function celebrateGraphite(kind: GraphiteCelebration): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(GRAPHITE_CELEBRATE_EVENT, { detail: kind }));
  }
}
