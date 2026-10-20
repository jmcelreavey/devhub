"use client";

import { describeTierChoice, MODEL_TIERS, TIER_LABEL, TIER_STEP_LABEL, type ModelTier, type ModelTierSettings, type TierStep } from "@/lib/storyboard/model-tiers-shared";

interface TierInlineProps {
  step: TierStep;
  settings: ModelTierSettings;
  tier: ModelTier;
  onTier: (tier: ModelTier) => void;
  save: boolean;
  onSave: (save: boolean) => void;
}

/** One compact select: the step's saved tier is preselected, so starting stays one click. Picking another offers to save it. */
export function TierInline({ step, settings, tier, onTier, save, onSave }: TierInlineProps) {
  const saved = settings.steps[step];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" role="group" aria-label="Model tier">
      <label className="flex items-center gap-2">
        <span className="text-text-muted">{TIER_STEP_LABEL[step]} tier</span>
        <select className="input" value={tier} onChange={(event) => onTier(event.target.value as ModelTier)}>
          {MODEL_TIERS.map((value) => (
            <option key={value} value={value}>
              {TIER_LABEL[value]} · {describeTierChoice(settings.tiers[value])}{value === saved ? " (saved)" : ""}
            </option>
          ))}
        </select>
      </label>
      {tier !== saved ? (
        <label className="flex items-center gap-1.5 text-text-muted">
          <input type="checkbox" checked={save} onChange={(event) => onSave(event.target.checked)} />
          Save {TIER_LABEL[tier]} as the {TIER_STEP_LABEL[step]} default
        </label>
      ) : null}
    </div>
  );
}
