"use client";

import { updateHollowEffects, useHollowEffects } from "@/components/hollow/useHollowEffects";
import type { HollowEffects } from "@/lib/hollow-theme";

const TOGGLES: {
  key: keyof HollowEffects;
  label: string;
  hint?: string;
}[] = [
  { key: "master", label: "Effects" },
  { key: "atmosphere", label: "Atmosphere", hint: "Layered fog, guttering light, grain and bottle wisps" },
  { key: "creatures", label: "Creatures", hint: "Watching eyes, spiders and a shadow passing through the fog." },
  { key: "rareEvents", label: "Rare events", hint: "A passing presence every few minutes. Requires Atmosphere, Creatures and motion." },
  { key: "interaction", label: "Interaction", hint: "Spectral trails, cobweb sway, cracks and heading glitch" },
  { key: "jumpScares", label: "Jump scares", hint: "Off unless you ask. Type boo outside a text field." },
  { key: "sound", label: "Sound", hint: "A low drone. Starts on this click. Stops when the tab hides." },
];

export function HollowEffectToggles() {
  const effects = useHollowEffects();

  return (
    <div className="hollow-effects">
      <div className="hollow-effects-label">Hollow</div>
      {TOGGLES.map(({ key, label, hint }) => {
        const on = effects[key];
        const dim = key !== "master" && (!effects.master
          || (key === "rareEvents" && (!effects.atmosphere || !effects.creatures)));
        return (
          <button
            key={key}
            type="button"
            className="hollow-toggle"
            aria-pressed={on}
            data-dim={dim || undefined}
            onClick={() => updateHollowEffects({ [key]: !on })}
          >
            <span>
              {label}
              {hint ? <span className="hollow-toggle-hint">{hint}</span> : null}
            </span>
            <span className="hollow-toggle-state">{on ? "On" : "Off"}</span>
          </button>
        );
      })}
    </div>
  );
}
