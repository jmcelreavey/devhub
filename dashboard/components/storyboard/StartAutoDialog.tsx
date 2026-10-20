"use client";

import { useState } from "react";
import { Zap } from "lucide-react";
import { ModalShell } from "@/components/shell/ModalShell";
import { describeTierChoice, MODEL_TIERS, TIER_LABEL, TIER_STEP_LABEL, TIER_STEPS, type ModelTier, type ModelTierSettings } from "@/lib/storyboard/model-tiers-shared";

interface StartAutoDialogProps {
  open: boolean;
  settings: ModelTierSettings;
  busy: boolean;
  onClose: () => void;
  onStart: (tiers: ModelTierSettings, saveAsDefaults: boolean, pauseAfterPlan: boolean) => void;
}

/** Start on auto with tiers other than the saved defaults: one row of step selects, then Start. */
export function StartAutoDialog({ open, settings, busy, onClose, onStart }: StartAutoDialogProps) {
  const [steps, setSteps] = useState(settings.steps);
  const [save, setSave] = useState(false);
  const [pauseAfterPlan, setPauseAfterPlan] = useState(true);
  const changed = TIER_STEPS.some((step) => steps[step] !== settings.steps[step]);
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Start on auto"
      description="Each step runs on its tier. Your saved defaults are preselected."
      icon={<Zap size={16} aria-hidden />}
      maxWidth="max-w-xl"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-1.5 text-sm text-text-muted">
            <input type="checkbox" checked={save} disabled={!changed} onChange={(event) => setSave(event.target.checked)} />
            Save these as my defaults
          </label>
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            {/* Autofocused so Enter starts: still one action from here. */}
            <button type="button" className="btn btn-primary" disabled={busy} autoFocus onClick={() => onStart({ ...settings, steps }, save && changed, pauseAfterPlan)}>
              {busy ? "Starting…" : "Start on auto"}
            </button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" role="group" aria-label="Tier per step">
        {TIER_STEPS.map((step) => (
          <label key={step} className="grid gap-1 text-xs text-text-muted">
            <span>{TIER_STEP_LABEL[step]}</span>
            <select className="input" value={steps[step]} onChange={(event) => setSteps((current) => ({ ...current, [step]: event.target.value as ModelTier }))}>
              {MODEL_TIERS.map((tier) => <option key={tier} value={tier} title={describeTierChoice(settings.tiers[tier])}>{TIER_LABEL[tier]}</option>)}
            </select>
          </label>
        ))}
      </div>
      <label className="flex items-center gap-2 mt-4 text-sm"><input type="checkbox" checked={pauseAfterPlan} disabled={busy} onChange={(event) => setPauseAfterPlan(event.target.checked)} />Pause after planning</label>
      <p className="mt-3 text-xs text-text-muted">
        {MODEL_TIERS.map((tier) => `${TIER_LABEL[tier]}: ${describeTierChoice(settings.tiers[tier])}`).join(" · ")}
      </p>
    </ModalShell>
  );
}
