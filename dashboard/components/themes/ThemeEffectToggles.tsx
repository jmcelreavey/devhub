"use client";

import { useId } from "react";
import { Check, GitMerge, RotateCcw } from "lucide-react";
import { useTheme } from "@/components/shell/ThemeToggle";
import { THEME_PRESETS } from "@/lib/theme-presets";
import { THEME_EFFECTS, effectEnabled, themeEffectDefaults, type EffectGroup } from "@/lib/theme-effects";
import { celebrateGraphite } from "@/lib/graphite-theme";
import { useGraphiteMotion } from "@/components/graphite/useGraphiteEffects";
import { ThemeMark } from "./ThemeMark";
import { updateThemeEffects, useThemeEffects } from "./useThemeEffects";

const GROUPS: EffectGroup[] = ["Atmosphere", "Feedback", "Pointer", "Extras"];

export function ThemeEffectToggles() {
  const { preset } = useTheme();
  const prefix = useId();
  const preferences = useThemeEffects(preset);
  const motion = useGraphiteMotion();
  const declaration = THEME_EFFECTS[preset];
  const label = THEME_PRESETS.find(theme => theme.id === preset)?.label ?? preset;
  if (!declaration) return <section className="theme-effects-settings"><p>This theme has not declared any effects. Its palette still follows your chosen mode.</p></section>;
  const canCelebrate = effectEnabled(preset, preferences, "celebrations", motion);
  return <section className="theme-effects-settings" aria-label={`${label} effects`}>
    <div className={`theme-effects-preview${preset === "graphite" ? " graphite-preview" : ""}`} aria-label="Effect preview with sample activity">
      <div className="theme-preview-heading"><ThemeMark preset={preset} /><div><strong>{declaration.title}</strong><p>{declaration.description}</p></div></div>
      <div className="theme-preview-work"><span className="theme-preview-agent"><i />Agent working <small>Preview only</small></span><div className="graphite-chart" aria-hidden="true">{[32, 48, 38, 65, 52, 78, 62, 90].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div></div>
      <div className="theme-preview-actions"><button type="button" className="btn btn-primary" disabled={!canCelebrate} onClick={() => celebrateGraphite("task")}><Check size={12} />Try task done</button><button type="button" className="btn btn-ghost" disabled={!canCelebrate} onClick={() => celebrateGraphite("merge")}><GitMerge size={12} />Try merge</button></div>
    </div>
    {preset === "hollow" && <p className="theme-effects-note">Switches on automatically in October. Pick another theme to opt out for the rest of the month.</p>}
    {!motion && <p className="theme-effects-note" role="status">Motion is paused. Static treatments stay; followers, celebrations and moving effects stop. Your saved choices have not changed.</p>}
    <button type="button" role="switch" aria-label="Theme effects" aria-checked={preferences.master} className="theme-effect-toggle theme-effect-master" onClick={() => updateThemeEffects(preset, { master: !preferences.master })}><span><strong>Theme effects</strong><small>Switch everything off, keep your choices.</small></span><span className="theme-effect-switch" aria-hidden="true"><i /></span></button>
    {GROUPS.map(group => {
      const effects = declaration.effects.filter(effect => effect.group === group);
      if (!effects.length) return null;
      return <fieldset key={group} className="theme-effect-group"><legend>{group}</legend>{effects.map(effect => {
        const disabled = !preferences.master || (effect.requires ?? []).some(required => !preferences[required]);
        return <button key={effect.id} type="button" role="switch" aria-label={effect.label} aria-describedby={`${prefix}-${effect.id}`} aria-checked={preferences[effect.id]} disabled={disabled} className="theme-effect-toggle" onClick={() => updateThemeEffects(preset, { [effect.id]: !preferences[effect.id] })}><span><strong>{effect.label}</strong><small id={`${prefix}-${effect.id}`}>{effect.description}</small><small className="theme-effect-policy">{effect.reducedMotion === "static" ? "Reduced motion: static" : effect.reducedMotion === "off" ? "Reduced motion: off" : "Reduced motion: unchanged"}</small></span><span className="theme-effect-switch" aria-hidden="true"><i /></span></button>;
      })}</fieldset>;
    })}
    <button type="button" className="btn btn-ghost theme-effects-reset" onClick={() => updateThemeEffects(preset, themeEffectDefaults(preset))}><RotateCcw size={12} />Reset this theme to defaults</button>
    <p className="theme-effects-note">Saved on this device, separately for each theme. Touch devices keep the native pointer.</p>
  </section>;
}
