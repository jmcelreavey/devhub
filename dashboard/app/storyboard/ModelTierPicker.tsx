"use client";

import { useEffect, useState } from "react";
import { ModelSelect, ProviderSelect } from "@/components/agents/ProviderModelSelects";
import { EffortSelect } from "@/components/agents/EffortSelect";
import { effortOptionsForModel } from "@/lib/ai/effort";
import { useToast } from "@/lib/hooks/use-toast";
import { DEFAULT_MODEL_TIERS, MODEL_TIERS, TIER_LABEL, TIER_STEP_LABEL as STEP_LABEL, TIER_STEPS, type ModelTier, type ModelTierChoice, type ModelTierSettings } from "@/lib/storyboard/model-tiers-shared";
import styles from "./storyboard.module.css";

interface Agent { id: string; name: string; ready: boolean; models: string[]; thinking?: Record<string, { id: string; label?: string }[]> }


/** Cheap / mid / heavy defaults Jev uses when a task starts Implement on auto. Saved for future runs. */
export function ModelTierPicker() {
  const toast = useToast();
  const [settings, setSettings] = useState<ModelTierSettings>(DEFAULT_MODEL_TIERS);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [defaultAgentId, setDefaultAgentId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetch("/api/storyboard/model-tiers").then((r) => r.json()).then((data) => data.settings && setSettings(data.settings)).catch(() => undefined);
    void fetch("/api/agent/connection", { signal: AbortSignal.timeout(15_000) }).then((r) => r.json()).then((data) => {
      setAgents(data.agents ?? []);
      setDefaultAgentId(data.defaultAgentId ?? "");
    }).catch(() => undefined);
  }, []);

  function setTier(tier: ModelTier, patch: Partial<ModelTierChoice>) {
    setSettings((current) => {
      const choice = { ...current.tiers[tier], ...patch };
      const agent = agents.find((item) => item.id === (choice.provider || defaultAgentId));
      const levels = effortOptionsForModel({ provider: agent?.id ?? choice.provider, model: choice.model, thinkingOptions: agent?.thinking?.[choice.model], availableModels: agent?.models });
      if (!levels?.some((option) => option.id === choice.effort)) delete choice.effort;
      return { ...current, tiers: { ...current.tiers, [tier]: choice } };
    });
  }

  async function save() {
    setSaving(true);
    try {
      const response = await fetch("/api/storyboard/model-tiers", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
      if (!response.ok) throw new Error();
      toast.success("Model tiers saved. New auto runs use them.");
    } catch {
      toast.error("Couldn't save model tiers.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.tierPicker} role="group" aria-label="Model tiers">
      <strong>Model tiers</strong>
      {MODEL_TIERS.map((tier) => {
        const choice = settings.tiers[tier];
        const agent = agents.find((item) => item.id === (choice.provider || defaultAgentId));
        return (
          <div key={tier} className={styles.tierRow} role="group" aria-label={TIER_LABEL[tier] + " tier"}>
            <span className={styles.tierName}>{TIER_LABEL[tier]}</span>
            <ProviderSelect label="Agent" value={choice.provider} defaultOption="Preferred" options={agents.map((item) => ({ id: item.id, label: item.name, disabled: !item.ready }))} onChange={(provider) => setTier(tier, { provider, model: "" })} />
            <ModelSelect label="Model" value={choice.model} models={agent?.models ?? []} onChange={(model) => setTier(tier, { model })} />
            <div className={styles.tierEffort}>
              <EffortSelect provider={agent?.id ?? choice.provider} model={choice.model} thinkingOptions={agent?.thinking?.[choice.model]} availableModels={agent?.models} value={choice.effort ?? ""} onChange={(effort) => setTier(tier, { effort: effort || undefined })} remember={false} />
            </div>
          </div>
        );
      })}
      <div className={styles.tierSteps}>
        {TIER_STEPS.map((step) => (
          <label key={step} className={styles.field}>
            <span>{STEP_LABEL[step]}</span>
            <select className="input" value={settings.steps[step]} onChange={(event) => setSettings((current) => ({ ...current, steps: { ...current.steps, [step]: event.target.value as ModelTier } }))}>
              {MODEL_TIERS.map((tier) => <option key={tier} value={tier}>{TIER_LABEL[tier]}</option>)}
            </select>
          </label>
        ))}
      </div>
      <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save as defaults"}</button>
    </div>
  );
}
