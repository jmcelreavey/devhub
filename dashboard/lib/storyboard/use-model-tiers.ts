"use client";

import useSWR, { mutate } from "swr";
import { DEFAULT_MODEL_TIERS, type ModelTierSettings } from "./model-tiers-shared";

export const MODEL_TIERS_KEY = "/api/storyboard/model-tiers";

async function fetchTiers(url: string): Promise<ModelTierSettings> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Model tiers: ${response.status}`);
  const data = (await response.json()) as { settings?: ModelTierSettings };
  return data.settings ?? DEFAULT_MODEL_TIERS;
}

/** Saved tier defaults, shared by Board settings, Start on auto and the launch sheet. */
export function useModelTiers(enabled = true): ModelTierSettings | undefined {
  return useSWR<ModelTierSettings>(enabled ? MODEL_TIERS_KEY : null, fetchTiers, { revalidateOnFocus: false }).data;
}

export async function saveModelTiers(settings: ModelTierSettings): Promise<boolean> {
  try {
    const response = await fetch(MODEL_TIERS_KEY, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
    if (!response.ok) return false;
    void mutate(MODEL_TIERS_KEY);
    return true;
  } catch {
    return false;
  }
}
